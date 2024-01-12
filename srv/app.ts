// AWS CDK
import {
  App,
  CfnOutput,
  Duration,
  Stack,
  StackProps,
  aws_certificatemanager as acm,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_dynamodb as dynamodb,
  aws_iam as iam,
  aws_lambda as lambda,
  aws_lambda_nodejs as nodejs,
  aws_route53 as route53,
  aws_route53_targets as targets,
  aws_s3 as s3,
} from 'aws-cdk-lib';

// Constructs
import { Construct } from 'constructs';

/**
 * Mallows GPT Stack Construct
 */
class MallowsGptStack extends Stack {
  /**
   * Creates a new stack.
   *
   * @param scope Parent of this stack, usually an `App` or a `Stage`, but could be any construct.
   * @param id The construct ID of this stack. If `stackName` is not explicitly
   * defined, this id (and any parent IDs) will be used to determine the
   * physical ID of the stack.
   * @param props Stack properties.
   */
  constructor(scope?: Construct, id?: string, props?: StackProps) {
    super(scope, id, props);

    // Context Values
    const [domainName, certificateArn, openaiApiKey, basicAuthUsername, basicAuthPassword, githubRepository, githubRef] = [
      this.node.getContext('domainName'),
      this.node.getContext('certificateArn'),
      this.node.getContext('openaiApiKey'),
      this.node.getContext('basicAuthUsername'),
      this.node.getContext('basicAuthPassword'),
      this.node.tryGetContext('githubRepository'),
      this.node.tryGetContext('githubRef'),
    ];

    // Api
    const api = new nodejs.NodejsFunction(this, 'Api', {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_20_X,
      timeout: Duration.minutes(15),
      memorySize: 1769, // 1 vCPU
      environment: {
        OPENAI_API_KEY: openaiApiKey,
      },
      bundling: {
        minify: true,
      },
    });

    // Add function url to Api.
    const { url: apiEndpoint } = api.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedHeaders: [
          '*',
        ],
        allowedOrigins: [
          `https://gpt.${domainName}`,
        ],
      },
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    // Api Endpoint
    new CfnOutput(this, 'ApiEndpoint', {
      value: apiEndpoint,
    });

    // App Table
    const appTable = new dynamodb.Table(this, 'AppTable', {
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // Add environment variable for access App Table.
    api.addEnvironment('APP_TABLE_NAME', appTable.tableName);

    // Add permissions to access App Table.
    appTable.grantReadWriteData(api);

    // App Bucket
    const appBucket = new s3.Bucket(this, 'AppBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // App Bucket Name
    new CfnOutput(this, 'AppBucketName', {
      value: appBucket.bucketName,
    });

    // Certificate
    const certificate = acm.Certificate.fromCertificateArn(this, 'Certificate', certificateArn);

    // App Distribution
    const appDistribution = new cloudfront.Distribution(this, 'AppDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(appBucket, {
          originPath: '/',
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        functionAssociations: [
          {
            function: new cloudfront.Function(this, 'BasicAuthFunction', {
              code: cloudfront.FunctionCode.fromInline(`
                function handler(event) {
                  if (
                    event.request.headers['user-agent'] &&
                    event.request.headers['user-agent'].value.includes('Android') &&
                    event.request.headers['user-agent'].value.includes('Line')
                  ) {
                    return {
                      statusCode: 302,
                      statusDescription: 'Found',
                      headers: {
                        location: {
                          value: 'googlechrome://navigate?url=https://' + event.request.headers.host.value + event.request.uri,
                        },
                      },
                    };
                  }

                  const username = '${basicAuthUsername}';
                  const password = '${basicAuthPassword}';

                  if (
                    event.request.headers.authorization &&
                    event.request.headers.authorization.value === 'Basic ' + (username + ':' + password).toString('base64')
                  ) {
                    return event.request;
                  }

                  return {
                    statusCode: 401,
                    statusDescription: 'Unauthorized',
                    headers: {
                      'www-authenticate': {
                        value: 'Basic',
                      },
                    },
                  };
                }
              `.replace(/^\s*| {16}|\s*$/g, '')),
              runtime: cloudfront.FunctionRuntime.JS_2_0,
            }),
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      certificate,
      defaultRootObject: 'index.html',
      domainNames: [
        `gpt.${domainName}`,
      ],
      errorResponses: [
        {
          ttl: Duration.days(1),
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/',
        },
        {
          ttl: Duration.days(1),
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/',
        },
      ],
    });

    // App Distribution ID
    new CfnOutput(this, 'AppDistributionId', {
      value: appDistribution.distributionId,
    });

    // Origin Access Control
    const originAccessControl = new cloudfront.CfnOriginAccessControl(this, 'OriginAccessControl', {
      originAccessControlConfig: {
        name: 'OriginAccessControlForMallowsGpt',
        originAccessControlOriginType: 's3',
        signingBehavior: 'always',
        signingProtocol: 'sigv4',
      },
    });

    // App Distribution L1 Construct
    const cfnAppDistribution = appDistribution.node.defaultChild as cloudfront.CfnDistribution;

    // Add a origin access control id.
    cfnAppDistribution.addPropertyOverride('DistributionConfig.Origins.0.OriginAccessControlId', originAccessControl.attrId);

    // Delete a origin access identity in s3 origin config.
    cfnAppDistribution.addPropertyOverride('DistributionConfig.Origins.0.S3OriginConfig.OriginAccessIdentity', '');

    // Delete a cloud front origin access identity.
    appDistribution.node.tryRemoveChild('Origin1');

    // Delete the default app bucket policy.
    appBucket.node.tryRemoveChild('Policy');

    // App Bucket Policy
    appBucket.policy = new s3.BucketPolicy(appBucket, 'Policy', {
      bucket: appBucket,
    });

    // Add the permission to access CloudFront.
    appBucket.policy.document.addStatements(new iam.PolicyStatement({
      actions: [
        's3:GetObject',
      ],
      principals: [
        new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      ],
      resources: [
        appBucket.arnForObjects('*'),
      ],
      conditions: {
        'StringEquals': {
          'AWS:SourceArn': `arn:aws:cloudfront::${this.account}:distribution/${appDistribution.distributionId}`,
        },
      },
    }));

    // Hosted Zone
    const zone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName,
    });

    // App Distribution Alias Record Target
    const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(appDistribution));

    // App Distribution Alias Record
    new route53.ARecord(this, 'AppDistributionAliasRecord', {
      zone,
      recordName: 'gpt',
      target,
    });

    // If the GitHub repository name and ref of the branch exists, create a role to cdk deploy from GitHub.
    if (githubRepository && githubRef) {
      // GitHub OpenID Connect Provider
      const githubOpenIdConnectProvider = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(this, 'GitHubOpenIdConnectProvider', `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`);

      // GitHub Deploy Role
      const githubDeployRole = new iam.Role(this, 'GitHubDeployRole', {
        assumedBy: new iam.WebIdentityPrincipal(githubOpenIdConnectProvider.openIdConnectProviderArn, {
          'StringEquals': {
            [`${githubOpenIdConnectProvider.openIdConnectProviderIssuer}:aud`]: 'sts.amazonaws.com',
          },
          'StringLike': {
            [`${githubOpenIdConnectProvider.openIdConnectProviderIssuer}:sub`]: `repo:${githubRepository}:ref:${githubRef}`,
          },
        }),
        inlinePolicies: {
          GitHubDeployRoleDefaultPolicy: new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                actions: [
                  'sts:AssumeRole',
                ],
                resources: [
                  `arn:aws:iam::${this.account}:role/cdk-${this.synthesizer.bootstrapQualifier}-*-role-${this.account}-*`,
                ],
              }),
            ],
          }),
        },
      });

      // Add permissions to access App Bucket.
      appBucket.grantReadWrite(githubDeployRole);

      // Add permissions to access App Distribution.
      appDistribution.grant(githubDeployRole, 'cloudfront:CreateInvalidation', 'cloudfront:GetInvalidation');
    }
  }
}

// CDK App
const app = new App();

// AWS Environment
const env = Object.fromEntries(['account', 'region'].map((key) => {
  return [key, process.env[`CDK_DEFAULT_${key.toUpperCase()}`]];
}));

// Mallows GPT Stack
new MallowsGptStack(app, 'MallowsGpt', {
  env,
});
