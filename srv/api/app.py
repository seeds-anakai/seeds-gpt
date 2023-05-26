from aws_lambda_powertools.event_handler import (
    APIGatewayRestResolver,
    CORSConfig,
)
from aws_lambda_powertools.utilities.typing import LambdaContext

# API Resolver
app = APIGatewayRestResolver(cors=CORSConfig(max_age=86400))

def handler(event: dict, context: LambdaContext) -> dict:
    return app.resolve(event, context)
