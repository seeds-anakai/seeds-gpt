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

// LangChain - Tools - Dynamic Structured Tool
import { DynamicStructuredTool } from '@langchain/core/tools';

// LangChain - Tools - Web Browser
import { WebBrowser } from 'langchain/tools/webbrowser';

// LangChain - Agents
import {
  AgentExecutor,
  createOpenAIFunctionsAgent,
} from 'langchain/agents';

// LangChain - Memory
import { BufferWindowMemory } from 'langchain/memory';

// Zod
import { z } from 'zod';

// City
import { City } from '@/enums/city';

// OpenAI
const openAi = new OpenAI();

// LangChain - OpenAI Embeddings
const embeddings = new OpenAIEmbeddings({
  modelName: 'text-embedding-ada-002',
});

// Lambda Handler
export const handler = awslambda.streamifyResponse(async ({ headers, requestContext, body }, responseStream) => {
  // Username and Password
  const username = process.env.BASIC_AUTH_USERNAME;
  const password = process.env.BASIC_AUTH_PASSWORD;

  // Get credentials from the username and password.
  const credentials = Buffer.from(`${username}:${password}`).toString('base64');

  if (headers.authorization === `Basic ${credentials}`) {
    if (requestContext.http.method === 'POST' && body) {
      // Get the input from the request body.
      const {
        input,
        imageUrls,
        history,
      } = JSON.parse(body);

      // LangChain - Chat OpenAI - GPT-4o
      const llm = new ChatOpenAI({
        modelName: 'gpt-4o-2024-05-13',
        temperature: 0,
        maxTokens: 1024,
        streaming: true,
      });

      // LangChain - Tools
      const tools = [
        new DynamicStructuredTool({
          name: 'genImageByDalle3',
          description: 'DALL·E 3を利用して画像を生成する',
          schema: z.object({
            prompt: z.string().describe('画像を生成するためのプロンプト'),
            size: z.enum([
              '1024x1024',
              '1792x1024',
              '1024x1792',
            ]).describe('生成する画像のサイズ。ユーザーの要望に最も近いものを選択する。特に要望がない場合は「1024x1024」とする'),
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
        new DynamicStructuredTool({
          name: 'getWeatherByCity',
          description: '日本の天気を取得する',
          schema: z.object({
            city: z.nativeEnum(City).describe('天気を取得する地名'),
          }),
          async func({ city }) {
            return await fetch(`https://weather.tsukumijima.net/api/forecast?city=${city}`).then((response) => {
              return response.text();
            });
          },
        }),
        new WebBrowser({
          model: llm,
          embeddings,
        }),
      ];

      // LangChain - Chat Prompt Template
      const prompt = ChatPromptTemplate.fromMessages([
        SystemMessagePromptTemplate.fromTemplate(`
          あなたは「Seeds GPT」と呼ばれるヘルプアシスタントです。
          指定がない限り日本語で回答します。
        `.replace(/ {10,12}/g, '').trim()),
        new MessagesPlaceholder('history'),
        HumanMessagePromptTemplate.fromTemplate([
          '{input}',
          ...imageUrls.map((url: string) => ({
            image_url: {
              url,
            },
          })),
        ]),
        new MessagesPlaceholder('agent_scratchpad'),
      ]);

      // LangChain - OpenAI Functions Agent
      const agent = await createOpenAIFunctionsAgent({
        llm,
        tools,
        prompt,
      });

      // LangChain - Buffer Window Memory
      const memory = new BufferWindowMemory({
        returnMessages: true,
        outputKey: 'output',
        k: 3,
      });

      // LangChain - Buffer Window Memory
      await Promise.all(history.map(({ type, text }: { type: 'ai' | 'human', text: string }) => {
        return memory.chatHistory[type === 'ai' ? 'addAIChatMessage' : 'addUserMessage'](text);
      }));

      // LangChain - Agent Executor
      const executor = AgentExecutor.fromAgentAndTools({
        agent,
        tools,
        memory,
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
    }
  }

  // Close a stream.
  responseStream.end();
});
