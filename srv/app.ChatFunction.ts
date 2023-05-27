// LangChain - Chat Models
import { ChatOpenAI } from 'langchain/chat_models/openai';

// LangChain - Chat OpenAI
const llm = new ChatOpenAI({
  temperature: 0,
  maxTokens: 1024,
  streaming: true,
});

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const params = JSON.parse(event.body ?? '{}');

  if (params.message) {
    await llm.predict(params.message, void 0, [
      {
        handleLLMNewToken(token: string) {
          responseStream.write(token);
        },
      },
    ]);
  }

  responseStream.end();
});
