from aws_lambda_powertools.event_handler import (
    APIGatewayRestResolver,
    CORSConfig,
)
from aws_lambda_powertools.utilities.typing import LambdaContext
from langchain.chains import RetrievalQA
from langchain.chat_models import ChatOpenAI
from langchain.embeddings import OpenAIEmbeddings
from langchain.vectorstores import DeepLake

# API Resolver
app = APIGatewayRestResolver(cors=CORSConfig(max_age=86400))

# LLM
llm = ChatOpenAI(model_name='gpt-3.5-turbo', temperature=0)

# Deep Lake
db = DeepLake(dataset_path='/tmp/deeplake', embedding_function=OpenAIEmbeddings())

# Retriever
retriever = db.as_retriever()

# Retrieval Question/Answering
qa = RetrievalQA.from_chain_type(llm=llm, chain_type='stuff', retriever=retriever)

@app.post('/messages')
def post_message():
    return {
        'message': qa.run(app.current_event.json_body['message']),
    }

def handler(event: dict, context: LambdaContext) -> dict:
    return app.resolve(event, context)
