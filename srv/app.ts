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
 * A root construct which represents a single CloudFormation stack.
 */
class QuailsGptStack extends Stack {
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

    // Hosted Zone
    const hostedZone = route53.HostedZone.fromLookup(this, 'HostedZone', {
      domainName,
    });

    // Certificate
    const certificate = acm.Certificate.fromCertificateArn(this, 'Certificate', certificateArn);

    // Chat Function
    const chatFunction = new nodejs.NodejsFunction(this, 'ChatFunction', {
      architecture: lambda.Architecture.ARM_64,
      runtime: lambda.Runtime.NODEJS_18_X,
      timeout: Duration.minutes(15),
      environment: {
        OPENAI_API_KEY: openaiApiKey,
      },
      bundling: {
        minify: true,
      },
    });

    // Add url to Chat Function.
    const chatFunctionUrl = chatFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedHeaders: [
          '*',
        ],
        allowedOrigins: [
          '*',
        ],
      },
    });

    // Change invoke mode to RESPONSE_STREAM.
    (chatFunctionUrl.node.defaultChild as lambda.CfnUrl).invokeMode = 'RESPONSE_STREAM';

    // Chat Function URL
    new CfnOutput(this, 'ChatFunctionUrl', {
      value: chatFunctionUrl.url,
    });

    // App Bucket
    const appBucket = new s3.Bucket(this, 'AppBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // Origin Access Identity
    const originAccessIdentity = new cloudfront.OriginAccessIdentity(this, 'OriginAccessIdentity', {
      comment: `access-identity-${appBucket.bucketRegionalDomainName}`,
    });

    // Add the permission to access CloudFront.
    appBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: [
        's3:GetObject',
      ],
      principals: [
        new iam.CanonicalUserPrincipal(originAccessIdentity.cloudFrontOriginAccessIdentityS3CanonicalUserId),
      ],
      resources: [
        appBucket.arnForObjects('*'),
      ],
    }));

    // App Distribution
    const appDistribution = new cloudfront.Distribution(this, 'AppDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(appBucket, {
          originAccessIdentity,
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

    // App Distribution Alias Record
    new route53.ARecord(this, 'AppDistributionAliasRecord', {
      zone: hostedZone,
      recordName: 'gpt',
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(
          appDistribution,
        ),
      ),
    });
  }
}

const app = new App();
new QuailsGptStack(app, 'QuailsGpt', {
  env: Object.fromEntries(['account', 'region'].map((key) => [
    key, process.env[`CDK_DEFAULT_${key.toUpperCase()}`],
  ])),
});
