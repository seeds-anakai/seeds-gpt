// OpenAI
import { OpenAI } from 'openai';

// LangChain - Chat Models
import { ChatOpenAI } from '@langchain/openai';

// LangChain - Prompts
import type { ChatPromptTemplate } from '@langchain/core/prompts';

// LangChain - Stores
import { DynamoDBChatMessageHistory } from '@langchain/community/stores/message/dynamodb';

// LangChain - Tools
import { DynamicStructuredTool } from '@langchain/community/tools/dynamic';

// LangChain - Agents
import { AgentExecutor, createOpenAIFunctionsAgent } from 'langchain/agents';

// LangChain - Memory
import { BufferWindowMemory } from 'langchain/memory';

// LangChain - Hub
import { pull } from 'langchain/hub';

// LangChain - Zod
import { z } from 'zod';

// OpenAI
const openAi = new OpenAI();

// LangChain - Chat OpenAI
const llm = new ChatOpenAI({
  temperature: 0,
  maxTokens: 1024,
  streaming: true,
  modelName: 'gpt-4-1106-preview',
});

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const { input, sessionId } = JSON.parse(event.body ?? '{}');

  // LangChain - Generate Image By Dalle
  const tools = [new DynamicStructuredTool({
    name: 'generateImageByDalle',
    description: 'DALL·Eを用いて画像を生成する。',
    schema: z.object({
      prompt: z.string().describe('画像を生成するためのプロンプト。'),
      size: z.enum([
        '256x256',
        '512x512',
        '1024x1024',
      ]).describe('生成する画像のサイズ。ユーザーの要望に最も近いものを選択する。特に要望がない場合は「1024x1024」とする。'),
    }),
    async func({ prompt, size }) {
      const { data } = await openAi.images.generate({
        prompt,
        size,
      });

      return data.flatMap(({ url }) => {
        if (url) {
          return [`![${url}](${url})`];
        } else {
          return [];
        }
      }).join('\n');
    },
  })];

  // LangChain - OpenAI Functions Agent Prompt
  const prompt = await pull<ChatPromptTemplate>('hwchase17/openai-functions-agent');

  // LangChain - OpenAI Functions Agent
  const agent = await createOpenAIFunctionsAgent({
    llm,
    tools,
    prompt,
  });

  // LangChain - DynamoDB Chat Message History
  const chatHistory = new DynamoDBChatMessageHistory({
    tableName: process.env.APP_TABLE_NAME,
    sessionId,
    partitionKey: 'id',
  });

  // LangChain - Buffer Window Memory
  const memory = new BufferWindowMemory({
    chatHistory,
    returnMessages: true,
    outputKey: 'output',
    memoryKey: 'chat_history',
    k: 3,
  });

  // LangChain - Agent Executor
  const agentExecutor = AgentExecutor.fromAgentAndTools({
    agent,
    tools,
    memory,
    verbose: true,
  });

  // Run a agent.
  await agentExecutor.invoke({ input }, {
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
