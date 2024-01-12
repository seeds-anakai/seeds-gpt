// OpenAI
import { OpenAI } from 'openai';

// LangChain - Chat Models
import {
  ChatOpenAI,
  OpenAIEmbeddings,
} from '@langchain/openai';

// LangChain - Prompts
import {
  ChatPromptTemplate,
  HumanMessagePromptTemplate,
  MessagesPlaceholder,
  SystemMessagePromptTemplate,
} from '@langchain/core/prompts';

// LangChain - Stores
import { DynamoDBChatMessageHistory } from '@langchain/community/stores/message/dynamodb';

// LangChain - Tools - Dynamic Structured Tool
import { DynamicStructuredTool } from '@langchain/community/tools/dynamic';

// LangChain - Tools - SearxNG API
import { SearxngSearch } from '@langchain/community/tools/searxng_search';

// LangChain - Tools - Web Browser
import { WebBrowser } from 'langchain/tools/webbrowser';

// LangChain - Agents
import {
  AgentExecutor,
  createOpenAIFunctionsAgent,
} from 'langchain/agents';

// LangChain - Memory
import { BufferMemory } from 'langchain/memory';

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

// LangChain - OpenAI Embeddings
const embeddings = new OpenAIEmbeddings({
  modelName: 'text-embedding-ada-002',
});

export const handler = awslambda.streamifyResponse(async (event, responseStream) => {
  const { input, sessionId } = JSON.parse(event.body ?? '{}');

  // LangChain - Tools
  const tools = [
    new DynamicStructuredTool({
      name: 'generateImageByDalle3',
      description: 'DALL·E 3を利用して画像を生成する。',
      schema: z.object({
        prompt: z.string().describe('画像を生成するためのプロンプト。'),
        size: z.enum([
          '1024x1024',
          '1792x1024',
          '1024x1792',
        ]).describe('生成する画像のサイズ。ユーザーの要望に最も近いものを選択する。特に要望がない場合は「1024x1024」とする。'),
      }),
      async func({ prompt, size }) {
        const { data } = await openAi.images.generate({
          model: 'dall-e-3',
          prompt,
          size,
        });

        return JSON.stringify(data);
      },
    }),
    new SearxngSearch({
      apiBase: 'https://searxng.site/',
      params: {
        numResults: 1,
        engines: 'google',
        language: 'ja-JP',
      },
    }),
    new WebBrowser({
      model: llm,
      embeddings,
    }),
  ];

  // LangChain - Chat Prompt Template
  const prompt = ChatPromptTemplate.fromMessages([
    SystemMessagePromptTemplate.fromTemplate(
      'あなたは「Mallows GPT」と呼ばれるヘルプアシスタントです。指定がない限り日本語で回答します。',
    ),
    new MessagesPlaceholder('history'),
    HumanMessagePromptTemplate.fromTemplate('{input}'),
    new MessagesPlaceholder('agent_scratchpad'),
  ]);

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

  // LangChain - Buffer Memory
  const memory = new BufferMemory({
    chatHistory,
    returnMessages: true,
    outputKey: 'output',
  });

  // LangChain - Agent Executor
  const executor = AgentExecutor.fromAgentAndTools({
    agent,
    tools,
    memory,
    verbose: true,
  });

  // Run an agent.
  await executor.invoke({ input }, {
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
