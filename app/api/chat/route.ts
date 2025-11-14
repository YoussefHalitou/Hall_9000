import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { queryTable, getTableNames, getTableStructure, queryTableWithJoin } from '@/lib/supabase-query'

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set')
}

/**
 * System prompt that instructs the AI on how to handle database queries
 */
const SYSTEM_PROMPT = `You are a helpful assistant connected to a Supabase database. Your role is to answer questions based EXCLUSIVELY on database content.

ABSOLUTE CRITICAL RULES - NEVER VIOLATE THESE:
1. NEVER hallucinate, invent, estimate, or guess data. ONLY use data returned from database queries.
2. ALWAYS query the database for data - never use data from previous responses, but USE conversation context to understand references.
3. If you don't have data from a database query, say "I don't have that information" - NEVER make up numbers or values.
4. NEVER announce what you're about to do. Just execute queries directly and provide the answer.
5. When asked about prices, costs, or any numerical data, you MUST query the database - never use previous answers or estimate.
6. FORBIDDEN PHRASES - NEVER use these: "Ich werde", "I will", "Let me", "Moment bitte", "Einen Moment", "Ich bin bereit", "I'm ready", "I can help", "Wie kann ich dir helfen", "Was möchtest du wissen", or any similar announcement phrases.
7. NEVER say you're about to do something - just do it silently and show the result.

CONTEXT UNDERSTANDING:
- You MUST understand conversation context to resolve references like "dafür" (for those), "für alle" (for all), "die Preise" (the prices), etc.
- When user says "Was sind die Preise dafür?" after listing materials, understand "dafür" refers to those materials.
- When user says "Für alle Materialien", understand they want prices for ALL materials mentioned previously.
- Use context to determine WHAT to query, but ALWAYS query the database to get the actual data.
- Example: If user asks "Was sind die Preise dafür?" after you listed materials, query prices for those materials using queryTableWithJoin.

QUERY STRATEGY:
- When a question requires database access, IMMEDIATELY call the appropriate function - no thinking, no announcements, just execute.
- For questions about related data (e.g., "Einkaufspreise der Materialien", "Verkaufspreise"), you MUST use queryTableWithJoin to join tables.
- ALWAYS query the database for data - use conversation context to understand WHAT to query, but get the actual data from the database.
- When user references previous messages (e.g., "dafür", "für alle", "die Preise"), use the context to determine what to query, then query it.
- Common table patterns: t_materials, t_material_prices, materials, material_prices, etc.
- Common foreign key patterns: material_id, product_id, user_id, order_id
- If user asks "Was sind die Preise?" or "Preise dafür" after materials were mentioned, query ALL materials with their prices using queryTableWithJoin.

PRICE QUERIES SPECIFICALLY:
- "Einkaufspreise" (purchase prices) = queryTableWithJoin('t_materials', 't_material_prices', 'material_id') and use the "cost_per_unit" or "Kosten pro Einheit" field
- "Verkaufspreise" (selling prices) = queryTableWithJoin('t_materials', 't_material_prices', 'material_id') and use the "price_per_unit" or "Preis pro Einheit" field
- NEVER assume prices based on previous queries - ALWAYS query the database for each price question
- If the user asks "und verkauf" after asking about purchase prices, you MUST query the database again to get selling prices

AVAILABLE FUNCTIONS:
- queryTable(tableName, filters, limit, joins?) - Query a single table or with joins
- queryTableWithJoin(tableName, joinTable, joinColumn?, filters, limit) - Join two related tables
- getTableStructure(tableName) - Get column names and sample data from a table
- getTableNames() - List available tables (may return empty if auto-discovery fails)

RESPONSE STYLE:
- Be direct and concise - answer the question immediately with data
- NEVER explain what you're going to do - just do it and show results
- Present data clearly and organized
- If an error occurs, explain what went wrong briefly, then suggest next steps
- When the user asks a question, IMMEDIATELY execute the query and return the data - no preamble, no announcements
- If you need to query the database, do it silently in the background and only show the final answer
- NEVER respond with "Ich bin bereit" or "I'm ready" - if you don't have a query to execute, wait for the user's question`

interface Message {
  role: 'system' | 'user' | 'assistant' | 'function' | 'tool'
  content: string
  name?: string
  tool_calls?: any[]
  tool_call_id?: string
}

interface ChatRequest {
  messages: Message[]
}

export async function POST(req: NextRequest) {
  try {
    const body: ChatRequest = await req.json()
    const { messages } = body

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: 'Messages array is required' },
        { status: 400 }
      )
    }

    // Prepare messages for OpenAI
    const openaiMessages: any[] = [
      {
        role: 'system',
        content: SYSTEM_PROMPT,
      },
    ]

    // Add user messages and assistant responses
    for (const message of messages) {
      const openaiMessage: any = {
        role: message.role,
        content: message.content,
      }
      
      // Preserve tool calls if present (for assistant messages)
      if (message.tool_calls) {
        openaiMessage.tool_calls = message.tool_calls
      }
      
      // Preserve tool call ID if present (for tool/function messages)
      if (message.tool_call_id) {
        openaiMessage.tool_call_id = message.tool_call_id
      }
      
      openaiMessages.push(openaiMessage)
    }

    // Create a completion with tools (function calling) for database queries
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: openaiMessages,
      tools: [
        {
          type: 'function',
          function: {
            name: 'queryTable',
            description: 'Query a table in the Supabase database with optional filters. Use this for simple queries on a single table.',
            parameters: {
              type: 'object',
              properties: {
                tableName: {
                  type: 'string',
                  description: 'The name of the table to query',
                },
                filters: {
                  type: 'object',
                  description: 'Optional filters to apply (key-value pairs)',
                  additionalProperties: true,
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 100)',
                  default: 100,
                },
                joins: {
                  type: 'array',
                  items: {
                    type: 'string',
                  },
                  description: 'Optional array of related tables to join. Use Supabase join syntax like ["prices(*)", "categories(*)"]',
                },
              },
              required: ['tableName'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'queryTableWithJoin',
            description: 'Query a table with a join to a related table. Use this when data is spread across multiple tables. For "Einkaufspreise der Materialien", use queryTableWithJoin with t_materials and t_material_prices. The function automatically tries multiple join patterns, so you can call it directly without checking structure first.',
            parameters: {
              type: 'object',
              properties: {
                tableName: {
                  type: 'string',
                  description: 'The name of the main table to query (e.g., "t_materials", "materials")',
                },
                joinTable: {
                  type: 'string',
                  description: 'The name of the related table to join (e.g., "t_material_prices", "material_prices", "prices")',
                },
                joinColumn: {
                  type: 'string',
                  description: 'Optional: The foreign key column name. For materials/prices, typically "material_id". If not provided, the function will try to auto-detect.',
                },
                filters: {
                  type: 'object',
                  description: 'Optional filters to apply to the main table (key-value pairs)',
                  additionalProperties: true,
                },
                limit: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 100)',
                  default: 100,
                },
              },
              required: ['tableName', 'joinTable'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'getTableNames',
            description: 'Get a list of available table names in the database',
            parameters: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'getTableStructure',
            description: 'Get the structure (column names) of a specific table. Use this to understand what fields are available before querying.',
            parameters: {
              type: 'object',
              properties: {
                tableName: {
                  type: 'string',
                  description: 'The name of the table to get structure for',
                },
              },
              required: ['tableName'],
            },
          },
        },
      ],
      tool_choice: 'auto',
      temperature: 0.3, // Lower temperature to reduce hallucinations and be more factual
    })

    const responseMessage = completion.choices[0].message

    // Check if the model wants to call a tool
    if (responseMessage.tool_calls && responseMessage.tool_calls.length > 0) {
      // Suppress announcement messages - if content is just announcing what will be done, ignore it
      const content = responseMessage.content
      const lowerContent = content?.toLowerCase() || ''
      const isAnnouncement = content && (
        lowerContent.includes('moment') ||
        lowerContent.includes('während ich') ||
        lowerContent.includes('i will') ||
        lowerContent.includes('let me') ||
        lowerContent.includes('ich werde') ||
        lowerContent.includes('ich versuche') ||
        lowerContent.includes('i\'ll') ||
        lowerContent.includes('ich bin bereit') ||
        lowerContent.includes('i\'m ready') ||
        lowerContent.includes('i can help') ||
        lowerContent.includes('wie kann ich dir helfen') ||
        lowerContent.includes('was möchtest du wissen') ||
        lowerContent.includes('was möchtest du tun') ||
        lowerContent.includes('einen moment') ||
        lowerContent.includes('einen augenblick') ||
        lowerContent.includes('ich werde nun') ||
        lowerContent.includes('ich werde jetzt') ||
        lowerContent.includes('ich werde versuchen') ||
        (content.length < 80 && (
          lowerContent.includes('query') ||
          lowerContent.includes('abfrage') ||
          lowerContent.includes('check') ||
          lowerContent.includes('prüfen') ||
          lowerContent.includes('daten abrufen') ||
          lowerContent.includes('informationen abrufen') ||
          lowerContent.includes('daten aus der datenbank') ||
          lowerContent.includes('informationen aus der datenbank')
        ))
      )

      // Add the assistant's tool call request to the conversation (with empty content if it's just an announcement)
      openaiMessages.push({
        role: 'assistant',
        content: isAnnouncement ? null : content,
        tool_calls: responseMessage.tool_calls,
      })

      // Execute all tool calls
      for (const toolCall of responseMessage.tool_calls) {
        const functionName = toolCall.function.name
        const functionArgs = JSON.parse(toolCall.function.arguments || '{}')

        let functionResult: any

        // Execute the function
        if (functionName === 'queryTable') {
          const result = await queryTable(
            functionArgs.tableName,
            functionArgs.filters || {},
            functionArgs.limit || 100,
            functionArgs.joins
          )
          functionResult = result
        } else if (functionName === 'queryTableWithJoin') {
          const result = await queryTableWithJoin(
            functionArgs.tableName,
            functionArgs.joinTable,
            functionArgs.joinColumn,
            functionArgs.filters || {},
            functionArgs.limit || 100
          )
          functionResult = result
        } else if (functionName === 'getTableNames') {
          const result = await getTableNames()
          functionResult = result
        } else if (functionName === 'getTableStructure') {
          const result = await getTableStructure(functionArgs.tableName)
          functionResult = result
        } else {
          functionResult = { error: `Unknown function: ${functionName}` }
        }

        // Add the function result to the conversation
        openaiMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(functionResult),
        })
      }

      // Get the final response from OpenAI after tool execution
      const finalCompletion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: openaiMessages,
        temperature: 0.3, // Lower temperature to reduce hallucinations and be more factual
      })

      const finalMessage = finalCompletion.choices[0].message

      return NextResponse.json({
        message: {
          role: 'assistant',
          content: finalMessage.content || 'I processed your request, but got no response.',
        },
      })
    }

    // Return the assistant's response
    return NextResponse.json({
      message: {
        role: 'assistant',
        content: responseMessage.content,
      },
    })
  } catch (error) {
    console.error('Chat API error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'An error occurred',
      },
      { status: 500 }
    )
  }
}

