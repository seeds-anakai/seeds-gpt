// LangChain - Chat Models
import { ChatOpenAI } from '@langchain/openai';

// LangChain - Stores
import { DynamoDBChatMessageHistory } from '@langchain/community/stores/message/dynamodb';

// LangChain - Memory
import { BufferWindowMemory } from 'langchain/memory';

// LangChain - Chains
import { ConversationChain } from 'langchain/chains';

// LangChain - Chat OpenAI
const llm = new ChatOpenAI({
  temperature: 0,
  maxTokens: 1024,
  streaming: true,
  modelName: 'gpt-4',
});

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const { input, sessionId } = JSON.parse(event.body ?? '{}');

  // LangChain - DynamoDB Chat Message History
  const chatHistory = new DynamoDBChatMessageHistory({
    tableName: process.env.APP_TABLE_NAME,
    sessionId,
    partitionKey: 'id',
  });

  // LangChain - Buffer Window Memory
  const memory = new BufferWindowMemory({
    chatHistory,
    k: 3,
  });

  // LangChain - Conversation Chain
  const chain = new ConversationChain({
    llm,
    memory,
  });

  // Call a chain.
  await chain.call({ input }, {
    callbacks: [
      {
        handleLLMNewToken(token: string) {
          responseStream.write(token);
        },
      },
    ],
  });

  responseStream.end();
});
