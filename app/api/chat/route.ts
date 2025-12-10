import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { queryTable, getTableNames, getTableStructure, queryTableWithJoin, getProjectsWithStaff } from '@/lib/supabase-query'

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

You have access to a PostgreSQL database with the following key tables (examples, not exhaustive):

- public.t_projects  
  → Projekte mit Kundenstammdaten, Projektstatus, Datum/Zeit, Dienstleistungsart, Kontaktdaten  
  (project_id, project_code, anrede, name, strasse, nr, plz, ort, telefon, email, notes, status, dienstleistungen, project_date, project_time, offer_type, created_at, updated_at)

- public.t_employees  
  → Mitarbeiter-Stammdaten  
  (employee_id, employee_code, name, email, phone, role, contract_type, weekly_hours_contract, hourly_rate, notes, is_active, created_at, updated_at)

- public.t_employee_daily_notes  
  → Tagesnotizen zu Mitarbeitern (z.B. Auffälligkeiten, Bemerkungen)

- public.t_employee_rate_history  
  → Historie von Stundensatz-Änderungen je Mitarbeiter

- public.t_morningplan  
  → Tagesplanung (plan_date, project_id, vehicle_id, start_time, service_type, notes, created_at, updated_at)

- public.t_morningplan_staff  
  → Mitarbeiter-Zuteilung zu MorningPlan-Einsätzen (plan_id, employee_id, role, individual_start_time, member_notes)

- public.t_vehicles / public.t_vehicle_rates / public.t_vehicle_daily_status / public.t_vehicle_inventory / public.t_vehicle_order_by_date  
  → Fahrzeuge, Tagessätze, Status („bereit" etc.), Inventar, Reihenfolge nach Datum

- public.t_materials / public.t_material_prices  
  → Materialkatalog (Name, Einheit, Kategorie, aktiv/aktiv) + EK/VK pro Material

- public.t_services / public.t_service_prices  
  → Leistungskatalog + Preise pro Entsorger/Supplier

- public.t_inspections / public.t_inspection_items / public.t_inspection_photos / public.t_inspection_signatures  
  → Besichtigungen (Kundendaten, Termin, Status) + Räume/Volumen/Personen/Stunden + Fotos + Unterschriften

- public.t_time_pairs  
  → Zeitpaare (LiS von/bis, Kunde von/bis, Pause, berechnete Stunden) je Projekt

- public.t_project_note_media  
  → Projektnotizen und Medien (Text/Fotos) zu spezifischen Feldern

There are also tmp_employees and tmp_projects import tables (temporary, mostly for migration).

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
   - **"Heute" / "Welchen Tag haben wir":**
     - DO NOT invent or hardcode dates like "1. November 2023"
     - Instead, infer from the data context (e.g., "based on recent project dates, today appears to be around [DATE]")
     - Or say: "Ich kann das aktuelle Datum nicht direkt abrufen, aber basierend auf den Projektdaten..."
     - When user asks "Welchen Tag haben wir heute?", be honest: "Ich habe keinen direkten Zugriff auf das aktuelle Systemdatum, aber ich kann dir Daten basierend auf den Projektdaten zeigen."
   - "Diese Woche" → Wochenspanne auf denselben Datumsfeldern (z.B. Montag bis Sonntag).
   - "Letzte X Tage/Wochen" → Zeitintervalle mit date ranges.

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

7. **CRITICAL: Use Specialized Functions:**
   - For ANY query about "Projekte mit Mitarbeitern", "Welche Mitarbeiter sind eingeplant", "Einsätze", etc.:
     **ALWAYS use the getProjectsWithStaff() function**
   - This function is specially designed to:
     * Always return employee NAMES (never IDs)
     * Always use correct JOINs
     * Return consistent, reliable data
   - Filter options:
     * plan_date: "2025-12-10" for specific dates
     * project_name: "Stojkovic" for specific projects
   - DO NOT try to manually join t_morningplan, t_morningplan_staff, t_employees yourself
   - The function handles all complexity and guarantees correct results

--------------------------------------------------
ANSWER STYLE
--------------------------------------------------

When answering:

1. Always in **German**, freundlich und praxisnah.

2. Structure answers roughly like:
   - 1–3 Sätze direkte Antwort auf die Frage.
   - Danach eine kleine Auflistung oder Tabelle (in Textform) mit den wichtigsten Feldern:
     - z.B. bei Mitarbeitern: Name, Rolle, contract_type, hourly_rate
     - bei MorningPlan: Datum, Projekt, Fahrzeug, Mitarbeiter
     - bei Projekten: project_code, name, ort, status, project_date

3. If the question was vague, explain kurz, welche Annahmen du getroffen hast:
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
        {
          type: 'function',
          function: {
            name: 'getProjectsWithStaff',
            description: 'Get projects from t_morningplan with assigned staff members. ALWAYS use this function when asked about "Projekte mit Mitarbeitern", "Welche Mitarbeiter", "Einsätze", or any query about project staffing. This function ALWAYS returns employee names (never IDs) with guaranteed correct JOINs. Returns: project details (name, location, services), vehicle name, and staff members with their names and roles.',
            parameters: {
              type: 'object',
              properties: {
                plan_date: {
                  type: 'string',
                  description: 'Filter by date (YYYY-MM-DD format). Use this for "today", "am 10.12.2025", "diese Woche", etc.',
                },
                project_id: {
                  type: 'string',
                  description: 'Filter by specific project ID (UUID)',
                },
                project_name: {
                  type: 'string',
                  description: 'Filter by project name (partial match, case-insensitive). Use this for "Projekt Stojkovic", "details Müller", etc.',
                },
              },
              required: [],
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
        } else if (functionName === 'getProjectsWithStaff') {
          const result = await getProjectsWithStaff({
            plan_date: functionArgs.plan_date,
            project_id: functionArgs.project_id,
            project_name: functionArgs.project_name,
          })
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

