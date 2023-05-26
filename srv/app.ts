// AWS CDK
import {
  App,
  CfnOutput,
  Duration,
  Stack,
  StackProps,
  aws_apigateway as apigateway,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as origins,
  aws_iam as iam,
  aws_lambda as lambda,
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

    // Api Handler
    const apiHandler = new lambda.DockerImageFunction(this, 'ApiHandler', {
      code: lambda.DockerImageCode.fromImageAsset('srv/api'),
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 1769, // 1 vCPU
    });

    // Api
    const api = new apigateway.LambdaRestApi(this, 'Api', {
      handler: apiHandler,
      deployOptions: {
        stageName: 'v1',
      },
      restApiName: "Quail's GPT API",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowHeaders: apigateway.Cors.DEFAULT_HEADERS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        maxAge: Duration.days(1),
      },
    });

    // Add the Gateway Response when the status code is 4XX.
    api.addGatewayResponse('GatewayResponseDefault4XX', {
      type: apigateway.ResponseType.DEFAULT_4XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
      },
    });

    // Add the Gateway Response when the status code is 5XX.
    api.addGatewayResponse('GatewayResponseDefault5XX', {
      type: apigateway.ResponseType.DEFAULT_5XX,
      responseHeaders: {
        'Access-Control-Allow-Origin': "'*'",
      },
    });

    // Remove the default endpoint output.
    api.node.tryRemoveChild('Endpoint');

    // Api Endpoint
    new CfnOutput(this, 'ApiEndpoint', {
      value: api.url,
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
    new cloudfront.Distribution(this, 'AppDistribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(appBucket, {
          originAccessIdentity,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
      defaultRootObject: 'index.html',
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
  }
}

const app = new App();
new QuailsGptStack(app, 'QuailsGpt', {
  env: { region: 'ap-northeast-1' },
});
