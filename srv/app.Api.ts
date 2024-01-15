// Node.js Core Modules
import { createHash } from 'crypto';

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

// LangChain - Messages
import {
  HumanMessage,
  MessageContent,
} from '@langchain/core/messages';

// LangChain - Stores
import { DynamoDBChatMessageHistory } from '@langchain/community/stores/message/dynamodb';

// LangChain - Tools - Dynamic Structured Tool
import { DynamicStructuredTool } from '@langchain/community/tools/dynamic';

// LangChain - Tools - Web Browser
import { WebBrowser } from 'langchain/tools/webbrowser';

// LangChain - Agents
import {
  AgentExecutor,
  createOpenAIFunctionsAgent,
} from 'langchain/agents';

// LangChain - Memory
import { BufferWindowMemory } from 'langchain/memory';

// LangChain - Chains
import { LLMChain } from 'langchain/chains';

// AWS SDK - S3
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

// AWS SDK - S3 Request Presigner
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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

// AWS SDK - S3 - Client
const s3 = new S3Client();

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
        sessionId,
      } = JSON.parse(body);

      if (imageUrls.length) {
        // LangChain - Chat OpenAI - GPT-4 Turbo with Vision
        const llm = new ChatOpenAI({
          modelName: 'gpt-4-vision-preview',
          temperature: 0,
          maxTokens: 1024,
          streaming: true,
        });

        // Signed Image URLs
        const signedImageUrls = await Promise.all(imageUrls.map(async (url: string) => {
          // Get a file.
          const response = await fetch(url);

          // Get a content type.
          const contentType = response.headers.get('content-type') ?? undefined;

          // Get a body.
          const body = await response.arrayBuffer().then(Buffer.from);

          // Get a key.
          const key = createHash('sha256').update(body).digest('hex');

          // Put a file.
          await s3.send(new PutObjectCommand({
            Bucket: process.env.FILE_BUCKET_NAME,
            Key: key,
            ContentType: contentType,
            Body: body,
          }));

          // Get a signed url.
          return await getSignedUrl(s3, new GetObjectCommand({
            Bucket: process.env.FILE_BUCKET_NAME,
            Key: key,
          }));
        }));

        // LangChain - Human Message Content
        const content: Exclude<MessageContent, string> = [];

        // Add the input.
        if (input) {
          content.push({
            type: 'text',
            text: input,
          });
        }

        // Add the signed image urls.
        signedImageUrls.forEach((url: string) => {
          content.push({
            type: 'image_url',
            image_url: {
              url,
            },
          });
        });

        // LangChain - Chat Prompt Template
        const prompt = ChatPromptTemplate.fromMessages([
          SystemMessagePromptTemplate.fromTemplate(`
            あなたは「Mallows GPT」と呼ばれるヘルプアシスタントです。
            指定がない限り日本語で回答します。
          `.replace(/ {10,12}/g, '').trim()),
          new MessagesPlaceholder('history'),
          new HumanMessage({
            content,
          }),
        ]);

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
          k: 3,
        });

        // LangChain - LLM Chain
        const chain = new LLMChain({
          llm,
          prompt,
          memory,
        });

        // Run a chain.
        await chain.invoke({ input: JSON.stringify(content) }, {
          callbacks: [
            {
              handleLLMNewToken(token: string) {
                responseStream.write(token);
              },
            },
          ],
        });
      } else {
        // LangChain - Chat OpenAI - GPT-4 Turbo
        const llm = new ChatOpenAI({
          modelName: 'gpt-4-1106-preview',
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
            あなたは「Mallows GPT」と呼ばれるヘルプアシスタントです。
            指定がない限り日本語で回答します。
          `.replace(/ {10,12}/g, '').trim()),
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

        // LangChain - Buffer Window Memory
        const memory = new BufferWindowMemory({
          chatHistory,
          returnMessages: true,
          outputKey: 'output',
          k: 3,
        });

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
  }

  // Close a stream.
  responseStream.end();
});
