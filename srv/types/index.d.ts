// AWS Lambda
import {
  APIGatewayProxyEventV2,
  Context,
  Handler,
} from 'aws-lambda';

declare global {
  namespace awslambda {
    function streamifyResponse(handler: (event: APIGatewayProxyEventV2, responseStream: NodeJS.WritableStream, context: Context) => Promise<void>): Handler;
  }
}
