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
    const [domainName, certificateArn, openaiApiKey] = [
      this.node.getContext('domainName'),
      this.node.getContext('certificateArn'),
      this.node.getContext('openaiApiKey'),
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

    // App Bucket
    const appBucket = new s3.Bucket(this, 'AppBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
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
