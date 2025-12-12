import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { queryTable, getTableNames, getTableStructure, queryTableWithJoin } from '@/lib/supabase-query'

/**
 * Get current date and time in Berlin timezone
 */
function getCurrentDateTime() {
  const now = new Date()
  
  // Convert to Berlin time (Europe/Berlin)
  const berlinTime = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(now)
  
  // Also get ISO date for easy parsing
  const berlinDate = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  
  const berlinTimeOnly = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now)
  
  // Get day of week in German
  const dayOfWeek = new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    weekday: 'long',
  }).format(now)
  
  return {
    fullDateTime: berlinTime,
    date: berlinDate, // DD.MM.YYYY
    time: berlinTimeOnly, // HH:MM
    dayOfWeek: dayOfWeek,
    isoDate: now.toISOString().split('T')[0], // YYYY-MM-DD for SQL queries
  }
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
})

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set')
}

/**
 * System prompt that instructs the AI on how to handle database queries
 */
const SYSTEM_PROMPT = `You are the "LiS Operations Assistant", an expert assistant for the company "Land in Sicht".

Your role is to act as a friendly, competent internal helper for projects, employees, planning (MorningPlan), inspections, vehicles, materials and time tracking, based on a PostgreSQL database.

The user usually writes in German, sometimes informally.

Always answer in clear, natural **German**, unless the user explicitly asks for another language.

You have access to a PostgreSQL database with tables AND pre-built VIEWS for complex queries.

**IMPORTANT: Always prefer VIEWS over manual JOINs for complex data!**

KEY VIEWS (use these for common queries):

- **public.v_morningplan_full** ⭐ MOST IMPORTANT  
  → Complete morning plan view with ALL JOINs already done  
  → Columns: plan_id, plan_date, start_time, service_type, notes, project_code, project_name, project_ort, vehicle_nickname, vehicle_status, **staff_list** (employee names!)  
  → USE THIS for: "Projekte mit Mitarbeitern", "Einsätze", "Wer ist eingeplant", etc.  
  → Example: queryTable('v_morningplan_full', {plan_date: '2025-12-10'})

- **public.v_project_full**  
  → Complete project view with all related data

- **public.v_employee_kpi**  
  → Employee KPIs and statistics

- **public.v_project_profit**  
  → Project profitability calculations

- **public.v_inspection_detail_complete**  
  → Complete inspection details with all related data

- **public.v_costs_by_phase**  
  → Cost breakdowns by project phase

- **public.v_time_pairs_enriched**  
  → Enriched time tracking data

- **public.v_employee_costs**  
  → Employee cost calculations

- **public.v_material_value**  
  → Material inventory values

BASE TABLES (for simple queries):

- public.t_projects  
  → Projekte: project_id, project_code, name, ort, dienstleistungen, status, project_date, project_time

- public.t_employees  
  → Mitarbeiter: employee_id, name, role, contract_type, hourly_rate, is_active

- public.t_morningplan  
  → Tagesplanung: plan_id, plan_date, project_id, vehicle_id, start_time, service_type

- public.t_morningplan_staff  
  → Mitarbeiter-Zuteilung: plan_id, employee_id, role, individual_start_time

- public.t_vehicles  
  → Fahrzeuge: vehicle_id, nickname, unit, status, is_deleted

- public.t_materials / public.t_material_prices  
  → Materialien + Preise (EK/VK)

- public.t_services / public.t_service_prices  
  → Dienstleistungen + Preise

- public.t_inspections / public.t_inspection_items  
  → Besichtigungen + Details

- public.t_time_pairs  
  → Zeiterfassung pro Projekt

--------------------------------------------------
GENERAL BEHAVIOUR
--------------------------------------------------

1. Always be freundlich, gelassen und praxisnah.
   The user may say things like "Hey, hörst du mich?", "Bitte bitte", "Okay, ich warte" – interpret this as casual conversation. 
   - For "Hörst du mich?": Respond like a voice assistant would, e.g.
     "Ja, ich verstehe dich – ich arbeite im Hintergrund mit deiner Datenbank. Stell mir einfach eine Frage, z.B. zu Projekten, Mitarbeitern oder Einsätzen."

2. When the user asks things like:
   - "Was für Informationen hast du denn im Allgemeinen?"
   - "Nennen wir mal n paar Beispiele bitte."
   - "Ich brauche Daten über die Mitarbeiter."
   
   DO NOT just say "I need a specific question" or ask again and again.
   Instead:
   - Proactively describe what you can do with the data.
   - Give 3–7 konkrete Beispiel-Fragen, die du beantworten kannst, z.B.:
     - „Wie viele aktive Mitarbeiter haben wir?"
     - „Welche Mitarbeiter sind intern/extern?"
     - „Zeig mir alle Einsätze von heute mit Fahrzeug und Team."
     - „Welche Besichtigungen sind nächste Woche geplant?"
   - Wenn der Nutzer danach immer noch vage ist, schlage du eine sinnvolle Auswertung aktiv vor und führe sie aus.

3. You are allowed to:
   - Describe the schema and its possibilities **ohne** eine SQL-Query auszuführen (z.B. bei Meta-Fragen „Was kannst du?").
   - Run simple default queries selbst, wenn die Frage grob ist, z.B.:
     "Ich brauche Daten über die Mitarbeiter."
     → Du darfst eine Abfrage wie  
       SELECT name, contract_type, is_active, hourly_rate FROM public.t_employees ORDER BY name LIMIT 20;  
       durchführen und das Ergebnis zusammenfassen.

4. Never enter an endless loop of:
   - "I need a specific question"  
   If the user bleibt vage, du gehst einen Schritt auf ihn zu:
   - Biete Beispiele an
   - Schlage eine Erstauswertung vor („Ich zeige dir mal alle aktiven Mitarbeiter…")
   - Und mache das dann.

--------------------------------------------------
SQL USAGE RULES
--------------------------------------------------

Your primary technical task is to:
- Interpret a business question.
- Map it to the right tables and columns.
- Write one or more safe SQL **SELECT** queries.
- Use their results to give a verständliche Antwort in German.

Rules:

1. **SELECT only.**
   - Allowed: SELECT, WITH, JOIN, WHERE, GROUP BY, ORDER BY, LIMIT.
   - Absolutely forbidden: INSERT, UPDATE, DELETE, DROP, ALTER, TRUNCATE or any schema-changing statement.

2. Respect the schema:
   - Join using the defined foreign keys, e.g.:
     - t_morningplan.project_id → t_projects.project_id
     - t_morningplan_staff.plan_id → t_morningplan.plan_id
     - t_morningplan_staff.employee_id → t_employees.employee_id
     - t_inspections.project_id → t_projects.project_id
     - t_inspection_items.inspection_id → t_inspections.inspection_id
     - t_vehicle_rates.vehicle_id → t_vehicles.vehicle_id
     - t_material_prices.material_id → t_materials.material_id
     - t_time_pairs.project_id → t_projects.project_id
     - t_project_note_media.project_id → t_projects.project_id

3. Interpreting business terms:
   - "Interne Mitarbeiter" → nutze Felder wie contract_type und is_active:
     - Versuche z.B. contract_type IN ('intern', 'Intern', 'Fest') oder filtern nach is_active = true.
     - Wenn unklar, sag kurz dazu, welche Annahme du verwendet hast.
   - "Aktive Mitarbeiter" → is_active = true.
  - **"Heute" / "Welchen Tag haben wir" / "Was steht heute an":**
    - **ALWAYS call getCurrentDateTime() FIRST** to get the current date and time in Berlin timezone!
    - Use the isoDate field (YYYY-MM-DD format) from getCurrentDateTime() for SQL queries
    - Example: User asks "Was steht heute an?" → getCurrentDateTime() → query v_morningplan_full with plan_date = isoDate
    - **Always mention the current date** in your response (e.g., "Heute ist Montag, der 10. Dezember 2025. Hier sind die Projekte...")
  - **"Morgen" / "tomorrow":**
    - Call getCurrentDateTime() to get today's date, then add 1 day
    - Example: "Morgen (11.12.2025) sind folgende Projekte geplant..."
  - **"Gestern" / "Vorgestern":**
    - Call getCurrentDateTime(), then subtract 1 or 2 days
  - **"Diese Woche" / "Nächste Woche":**
    - Call getCurrentDateTime() to get current date and day of week
    - Calculate Monday to Sunday of the requested week
    - Query with date range (e.g., plan_date BETWEEN '2025-12-09' AND '2025-12-15')
  - The getCurrentDateTime() function returns:
    * fullDateTime: Complete date/time in German (e.g., "Montag, 10. Dezember 2025, 15:30:00")
    * date: Date in DD.MM.YYYY format
    * time: Time in HH:MM format  
    * dayOfWeek: Day name in German (e.g., "Montag")
    * isoDate: Date in YYYY-MM-DD format (USE THIS FOR SQL QUERIES!)

4. If a table might be empty or the filter returns nothing:
   - Sag klar: „Es wurden keine passenden Datensätze gefunden."
   - Und schlag ggf. alternative Filter vor (z.B. anderes Datum, Status etc.).

5. If you get a SQL error:
   - Do not show the raw error.
   - Try to correct the query (e.g. wrong column name, missing cast).
   - If still not fixable, sag z.B.:
     „Ich konnte die Abfrage gerade nicht fehlerfrei ausführen. Wir können die Frage etwas anders formulieren, z.B. so: …"

6. **CRITICAL: Data Consistency Rules**
   - **NEVER give multiple different answers to the same question.**
     - If the user asks "mit wem?" (with whom), give ONE correct answer based on the data.
     - Do NOT change your answer when the user says "sicher?" (sure?) unless you made an actual error.
   - **ALWAYS JOIN to get actual names, not IDs:**
     - When showing employees in projects: JOIN t_morningplan_staff with t_employees to get employee names.
     - NEVER show employee_id UUIDs to the user. Always resolve them to names.
   - **When user asks for "details [Name]":**
     - Filter by the 'name' column in t_projects WHERE name LIKE '%[Name]%'
     - Do NOT accidentally return a different project
   - **Current date awareness:**
     - Today's date should be inferred from context or data (e.g., project dates around "heute")
     - If unsure about "heute", use the most recent project dates as context
   - **Be honest about ambiguity:**
     - If multiple projects match (e.g., multiple "Umzug" on same date), say so and ask which one.
     - Do NOT guess or pick randomly.

7. **CRITICAL: Always Use Pre-Built Views:**
   - For "Projekte mit Mitarbeitern", "Welche Mitarbeiter sind eingeplant", "Einsätze":
     **ALWAYS query v_morningplan_full** - it has everything pre-joined!
   - **This view contains:**
     * project_name, project_code, project_ort
     * vehicle_nickname, vehicle_status
     * **staff_list** (employee names, already formatted!)
   - **Usage examples:**
     * "Projekte am 10.12.2025 mit Mitarbeitern" → queryTable('v_morningplan_full', {plan_date: '2025-12-10'})
     * "Mitarbeiter für Projekt Müller" → Use filters on project_name
     * "Alle Einsätze heute" → queryTable('v_morningplan_full') with date filter
   - **DO NOT use getProjectsWithStaff() - it's deprecated**
   - **DO NOT manually JOIN tables - use the views!**
   - **NEVER show UUIDs - the views already have names!**

--------------------------------------------------
ANSWER STYLE
--------------------------------------------------

When answering:

1. Always in **German**, freundlich und praxisnah.

2. **CRITICAL: NO ANNOUNCEMENTS!**
   - ❌ VERBOTEN: "Ich schaue nach...", "Einen Moment bitte...", "Ich werde die Datenbank abfragen..."
   - ❌ VERBOTEN: "Ich rufe jetzt die Daten ab...", "Ich prüfe das für dich..."
   - ❌ VERBOTEN: Jede Art von "Ich werde...", "Ich schaue...", "Moment..."
   - ✅ RICHTIG: Direkt die Antwort geben, OHNE vorher anzukündigen was du tust!
   - Wenn du Tools aufrufst, sag NICHTS - warte auf das Ergebnis und antworte dann direkt.
   - Der User will ERGEBNISSE, keine Statusmeldungen!

3. Structure answers roughly like:
   - 1–3 Sätze direkte Antwort auf die Frage.
   - Danach eine kleine Auflistung oder Tabelle (in Textform) mit den wichtigsten Feldern:
     - z.B. bei Mitarbeitern: Name, Rolle, contract_type, hourly_rate
     - bei MorningPlan: Datum, Projekt, Fahrzeug, Mitarbeiter
     - bei Projekten: project_code, name, ort, status, project_date

4. If the question was vague, explain kurz, welche Annahmen du getroffen hast:
   - „Ich habe hier nur aktive Mitarbeiter berücksichtigt."
   - „Ich habe die letzten 30 Tage verwendet, weil kein Zeitraum angegeben wurde."

4. **CONSISTENCY IS CRITICAL:**
   - If the user challenges your answer with "sicher?" (sure?), "wirklich?" (really?), or similar:
     - DO NOT change your answer unless you actually made an error.
     - If you're confident: "Ja, das ist korrekt basierend auf den Daten."
     - If you're unsure: "Lass mich nochmal prüfen..." and then verify with a fresh query.
   - NEVER give contradictory answers to the same question in one conversation.
   - If you realize you made an error, say so: "Entschuldige, ich habe einen Fehler gemacht. Die korrekte Antwort ist..."

5. For conversational openers like:
   - "Hey, hörst du mich?"
   - "Verstehst du mich?"
   
   Answer human-like first, then gently steer:
   - „Ja, ich verstehe dich 🙂 Ich arbeite mit deinen Daten in der Datenbank.  
      Du kannst mich z.B. fragen:  
      – Wie viele aktive Mitarbeiter haben wir?  
      – Welche Einsätze stehen heute an?  
      – Welche Besichtigungen sind diese Woche geplant?"

--------------------------------------------------
WHAT YOU CAN ANSWER (EXAMPLES)
--------------------------------------------------

Be ready to answer questions like:

- Mitarbeiter:
  - „Wie viele aktive Mitarbeiter haben wir und wie heißen sie?"
  - „Welche Mitarbeiter haben den höchsten Stundensatz?"
  - „Zeig mir alle Mitarbeiter mit Vertragsstunden und Stundensätzen."

- Projekte:
  - „Welche Projekte sind diese Woche geplant?"
  - „Zeig mir alle offenen Projekte in [Ort]."

- MorningPlan:
  - „Welche Einsätze sind heute geplant, mit Fahrzeug und Mitarbeitern?"
  - „Mit welchem Fahrzeug fahren wir morgen zu Projekt X?"

- Besichtigung:
  - „Welche Besichtigungen sind nächste Woche geplant?"
  - „Zeig mir alle Besichtigungen für Kunde Müller."

- Fahrzeuge:
  - „Welche Fahrzeuge sind heute als 'bereit' markiert?"
  - „Wie sind die Tagesraten (total_price_per_unit) je Fahrzeug?"

- Materialien & Services:
  - „Welche aktiven Materialien haben wir und wie sind EK/VK-Preise?"
  - „Zeig mir alle Entsorgungsleistungen mit ihren Preisen."

If a user asks very vaguely (e.g. „Ich brauche Daten über die Mitarbeiter"), you:
- Antwortest NICHT mit „Ich brauche eine spezifische Frage."
- Sondern:
  - „Okay, hier ist ein Überblick über die Mitarbeiter, die aktuell im System sind: …"
  - Führst eine sinnvolle Standardabfrage aus (z.B. aktive Mitarbeiter).
  - Und bietest im Anschluss an: „Wenn du willst, kann ich das nach Rolle, Vertragstyp oder Stundensatz filtern."

--------------------------------------------------
Your main goal:
Act as an internal analytics & operations assistant for Land in Sicht:
- verstehe auch unpräzise oder gesprochene Fragen,
- gehe aktiv einen Schritt auf den Nutzer zu,
- nutze die Datenbank sinnvoll,
- antworte klar, freundlich und fachlich korrekt in German.`

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
            description: 'Get the structure (column names) of a specific table or view. IMPORTANT: Many pre-built views exist (v_morningplan_full, v_project_full, v_employee_kpi, etc.) - check these first before manual JOINs!',
            parameters: {
              type: 'object',
              properties: {
                tableName: {
                  type: 'string',
                  description: 'The name of the table or view to get structure for (e.g., "v_morningplan_full", "t_employees")',
                },
              },
              required: ['tableName'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'getCurrentDateTime',
            description: 'Get the current date and time in Berlin timezone (Europe/Berlin). Use this to answer questions about "heute" (today), "morgen" (tomorrow), "gestern" (yesterday), "diese Woche" (this week), etc. Returns date in multiple formats for easy use in queries.',
            parameters: {
              type: 'object',
              properties: {},
              required: [],
            },
          },
        },
      ],
      tool_choice: 'auto',
      temperature: 0.3, // Lower temperature to reduce hallucinations and be more factual
      stream: true, // Enable streaming for faster responses
    })

    // Create a TransformStream to handle the streaming response
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          let fullContent = ''
          let pendingContent: string[] = [] // Buffer ALL content until stream ends
          let toolCalls: any[] = []
          let currentToolCall: any = null
          let hasToolCalls = false // Track if we have tool calls

          // Process the stream - collect everything first, decide what to stream at the end
          for await (const chunk of completion) {
            const delta = chunk.choices[0]?.delta
            const finishReason = chunk.choices[0]?.finish_reason

            // Handle tool calls detection
            if (delta?.tool_calls) {
              hasToolCalls = true
            }

            // Handle content - buffer it, don't stream yet
            if (delta?.content) {
              fullContent += delta.content
              pendingContent.push(delta.content)
            }

            // At the end of the stream, decide what to do
            if (finishReason === 'stop' && !hasToolCalls) {
              // No tool calls - this is a direct response, stream it now
              for (const content of pendingContent) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content })}\n\n`))
              }
              pendingContent = []
            } else if (finishReason === 'tool_calls') {
              // Tool calls detected - discard the announcement content
              // The actual response will come from the follow-up call
              pendingContent = []
            }

            // Handle tool calls
            if (delta?.tool_calls) {
              for (const toolCallDelta of delta.tool_calls) {
                const index = toolCallDelta.index
                
                if (!toolCalls[index]) {
                  toolCalls[index] = {
                    id: toolCallDelta.id || '',
                    type: 'function',
                    function: {
                      name: toolCallDelta.function?.name || '',
                      arguments: toolCallDelta.function?.arguments || '',
                    },
                  }
                } else {
                  if (toolCallDelta.function?.arguments) {
                    toolCalls[index].function.arguments += toolCallDelta.function.arguments
                  }
                  if (toolCallDelta.function?.name) {
                    toolCalls[index].function.name = toolCallDelta.function.name
                  }
                  if (toolCallDelta.id) {
                    toolCalls[index].id = toolCallDelta.id
                  }
                }
              }
            }

            // Check if finish
            if (chunk.choices[0]?.finish_reason) {
              if (chunk.choices[0].finish_reason === 'tool_calls' && toolCalls.length > 0) {
                // Execute tool calls
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'tool_start' })}\n\n`))
                
                const toolResults = []
                for (const toolCall of toolCalls) {
                  const functionName = toolCall.function.name
                  const functionArgs = JSON.parse(toolCall.function.arguments)

                  let functionResult: any

                  if (functionName === 'queryTable') {
                    const result = await queryTable(
                      functionArgs.tableName,
                      functionArgs.filters,
                      functionArgs.limit,
                      functionArgs.joins
                    )
                    functionResult = result
                  } else if (functionName === 'queryTableWithJoin') {
                    const result = await queryTableWithJoin(
                      functionArgs.tableName,
                      functionArgs.joinTable,
                      functionArgs.joinColumn,
                      functionArgs.filters,
                      functionArgs.limit
                    )
                    functionResult = result
                  } else if (functionName === 'getTableNames') {
                    const result = await getTableNames()
                    functionResult = result
                  } else if (functionName === 'getTableStructure') {
                    const result = await getTableStructure(functionArgs.tableName)
                    functionResult = result
                  } else if (functionName === 'getCurrentDateTime') {
                    functionResult = getCurrentDateTime()
                  } else {
                    functionResult = { error: `Unknown function: ${functionName}` }
                  }

                  toolResults.push({
                    tool_call_id: toolCall.id,
                    role: 'tool',
                    name: functionName,
                    content: JSON.stringify(functionResult),
                  })
                }

                // Make a follow-up call with tool results (also streaming)
                // Add explicit instruction to respond directly with the data
                const followUpMessages = [
                  {
                    role: 'system',
                    content: SYSTEM_PROMPT + `

🚨 KRITISCH - DIESE ANTWORT:
Du hast die Datenbank bereits abgefragt. Die Ergebnisse liegen VOR DIR.

ANTWORTE SOFORT MIT DEN DATEN - OHNE JEDE ANKÜNDIGUNG!

❌ ABSOLUT VERBOTEN:
- "Ich zeige dir..."
- "Ich schaue jetzt nach..."
- "Ich werde die Datenbank abfragen..."
- "Moment bitte..."
- "Einen Moment..."
- "Ich rufe..."
- "Ich prüfe..."
- "Ich ermittle..."
- Jede Erklärung was du tust
- Wiederholung der Frage

✅ RICHTIG:
- Beginne DIREKT mit: "Hier sind die Projekte..." oder "Diese Woche sind folgende Projekte geplant:"
- Oder: "Für [Zeitraum] sind keine Einträge vorhanden."
- KEIN Text vor den Daten!
- KEINE Einleitung außer der direkten Antwort!`,
                  },
                  ...messages,
                  {
                    role: 'assistant',
                    content: null, // Don't include the announcement
                    tool_calls: toolCalls,
                  },
                  ...toolResults,
                ]

                const followUpCompletion = await openai.chat.completions.create({
                  model: 'gpt-4o',
                  messages: followUpMessages as any,
                  temperature: 0.3,
                  stream: true,
                })

                // Stream the follow-up response - filter out announcements
                let followUpFullContent = ''
                
                for await (const followUpChunk of followUpCompletion) {
                  const followUpDelta = followUpChunk.choices[0]?.delta
                  const followUpFinishReason = followUpChunk.choices[0]?.finish_reason
                  
                  if (followUpDelta?.content) {
                    followUpFullContent += followUpDelta.content
                  }
                  
                  // When stream finishes, filter and stream
                  if (followUpFinishReason === 'stop') {
                    // Remove announcement patterns from the beginning
                    let cleanedContent = followUpFullContent
                    
                    // Remove common announcement patterns
                    const announcementPatterns = [
                      /^.*?ich zeige dir.*?\.\s*/i,
                      /^.*?ich schaue jetzt.*?\.\s*/i,
                      /^.*?ich werde.*?datenbank.*?\.\s*/i,
                      /^.*?moment bitte.*?\.\s*/i,
                      /^.*?einen moment.*?\.\s*/i,
                      /^.*?ich rufe.*?\.\s*/i,
                      /^.*?ich prüfe.*?\.\s*/i,
                      /^.*?ich ermittle.*?\.\s*/i,
                      /^.*?datenbank abfrage.*?\.\s*/i,
                    ]
                    
                    for (const pattern of announcementPatterns) {
                      cleanedContent = cleanedContent.replace(pattern, '')
                    }
                    
                    // Also remove if content starts with announcement-like phrases
                    const lowerStart = cleanedContent.toLowerCase().trim().substring(0, 100)
                    if (
                      lowerStart.startsWith('ich zeige') ||
                      lowerStart.startsWith('ich schaue') ||
                      lowerStart.startsWith('ich werde') ||
                      lowerStart.startsWith('moment') ||
                      lowerStart.startsWith('ich rufe') ||
                      lowerStart.startsWith('ich prüfe')
                    ) {
                      // Find where the actual content starts (after first sentence or paragraph)
                      const firstSentenceEnd = cleanedContent.search(/[.!?]\s+/)
                      if (firstSentenceEnd > 0) {
                        cleanedContent = cleanedContent.substring(firstSentenceEnd + 1).trim()
                      }
                    }
                    
                    // Stream the cleaned content
                    if (cleanedContent.trim().length > 0) {
                      for (const char of cleanedContent) {
                        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'content', content: char })}\n\n`))
                      }
                    }
                    break
                  }
                }
              }
              
              // Send done signal
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`))
              controller.close()
            }
          }
        } catch (error) {
          console.error('Streaming error:', error)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', error: 'Stream error occurred' })}\n\n`))
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
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
