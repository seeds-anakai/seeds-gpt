// LangChain - Chat Models
import { ChatOpenAI } from 'langchain/chat_models/openai';

// LangChain - Chat OpenAI
const llm = new ChatOpenAI({
  temperature: 0,
  maxTokens: 1024,
  streaming: true,
  modelName: 'gpt-4',
});

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const { message } = JSON.parse(event.body ?? '{}');

  if (message) {
    await llm.invoke(message, {
      callbacks: [
        {
          handleLLMNewToken(token: string) {
            responseStream.write(token);
          },
        },
      ],
    });
  }

  responseStream.end();
});
