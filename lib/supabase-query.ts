import { supabaseAdmin } from './supabase'

/**
 * Execute a read-only SQL query via Supabase REST API
 * Note: This requires the service role key and uses the REST API directly
 */
export async function executeReadOnlyQuery(sql: string) {
  try {
    if (!supabaseAdmin) {
      throw new Error('Service role key not configured')
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    // Use Supabase REST API for raw SQL queries
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ query: sql }),
    })

    if (!response.ok) {
      // Fallback: try to query tables directly using Supabase client methods
      // This is a safer approach that works with the standard client
      throw new Error('Direct SQL execution requires custom RPC function')
    }

    const data = await response.json()
    return { data, error: null }
  } catch (err) {
    // Return error for OpenAI to handle
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Query execution failed'
    }
  }
}

/**
 * Get table names from Supabase
 * Uses PostgREST introspection to discover available tables
 */
export async function getTableNames() {
  try {
    if (!supabaseAdmin) {
      return { 
        tables: [], 
        error: 'Service role key not configured. Please set SUPABASE_SERVICE_ROLE_KEY in your environment variables.' 
      }
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

    // Try to get schema information using PostgREST's OpenAPI endpoint
    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/`, {
        method: 'GET',
        headers: {
          'apikey': serviceKey,
          'Authorization': `Bearer ${serviceKey}`,
        },
      })

      if (response.ok) {
        // The root endpoint returns OpenAPI schema
        const schema = await response.json()
        
        // Extract table names from the OpenAPI paths
        if (schema.paths) {
          const tables = Object.keys(schema.paths)
            .filter(path => path.startsWith('/') && !path.includes('rpc'))
            .map(path => path.replace(/^\//, ''))
            .filter(table => table && !table.includes('{'))
          
          if (tables.length > 0) {
            return { tables, error: null }
          }
        }
      }
    } catch (fetchError) {
      // Fall through to alternative method
      console.log('OpenAPI introspection failed, trying alternative method')
    }

    // Alternative: Try to query information_schema via RPC
    // This requires a custom RPC function in Supabase
    try {
      const { data, error } = await supabaseAdmin.rpc('get_table_names')
      
      if (!error && data) {
        return { tables: data, error: null }
      }
    } catch (rpcError) {
      // RPC function doesn't exist, continue to next method
    }

    // Last resort: Try querying information_schema directly via REST
    // Note: This may not work due to RLS, but worth trying
    try {
      const response = await fetch(
        `${supabaseUrl}/rest/v1/information_schema.tables?table_schema=eq.public&select=table_name`,
        {
          method: 'GET',
          headers: {
            'apikey': serviceKey,
            'Authorization': `Bearer ${serviceKey}`,
            'Prefer': 'return=representation',
          },
        }
      )

      if (response.ok) {
        const data = await response.json()
        if (Array.isArray(data) && data.length > 0) {
          const tables = data.map((row: any) => row.table_name).filter(Boolean)
          if (tables.length > 0) {
            return { tables, error: null }
          }
        }
      }
    } catch (infoSchemaError) {
      // information_schema query failed
    }

    // If all methods fail, return empty with helpful message
    return { 
      tables: [], 
      error: 'Could not automatically discover tables. You can still query tables by name using the queryTable function. Common table names might include: users, products, orders, etc. Try asking about specific data and I will attempt to query the relevant tables.' 
    }
  } catch (err) {
    return {
      tables: [],
      error: err instanceof Error ? err.message : 'Unknown error while fetching table names'
    }
  }
}

/**
 * Get table structure (columns) for a specific table
 * This helps understand what fields are available
 */
export async function getTableStructure(tableName: string) {
  try {
    if (!supabaseAdmin) {
      return {
        columns: [],
        error: 'Service role key not configured'
      }
    }

    // Try to get one row to see the structure
    const { data, error } = await supabaseAdmin
      .from(tableName)
      .select('*')
      .limit(1)

    if (error) {
      return {
        columns: [],
        error: error.message
      }
    }

    // Extract column names from the first row
    if (data && data.length > 0) {
      const columns = Object.keys(data[0])
      return {
        columns,
        error: null,
        sampleRow: data[0] // Include a sample row to help understand data types
      }
    }

    // If no data but table exists, try to infer from error or return empty
    return {
      columns: [],
      error: null,
      message: 'Table exists but contains no data'
    }
  } catch (err) {
    return {
      columns: [],
      error: err instanceof Error ? err.message : 'Unknown error'
    }
  }
}

/**
 * Query a specific table with filters and optional joins
 * Supports various filter types: eq, neq, gt, gte, lt, lte, like, ilike, in
 * Supports joins using Supabase's relationship syntax: 'related_table(*)'
 */
export async function queryTable(
  tableName: string,
  filters: Record<string, any> = {},
  limit: number = 100,
  joins?: string[]
) {
  try {
    if (!supabaseAdmin) {
      return {
        data: null,
        error: 'Service role key not configured. Please set SUPABASE_SERVICE_ROLE_KEY in your environment variables.'
      }
    }

    // Build select statement with joins if provided
    let selectStatement = '*'
    if (joins && joins.length > 0) {
      selectStatement = `*, ${joins.join(', ')}`
    }

    let query = supabaseAdmin.from(tableName).select(selectStatement).limit(limit)

    // Apply filters
    // Support both simple key-value (defaults to eq) and advanced filter objects
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null) {
        continue
      }

      // If value is an object with filter type, use it
      if (typeof value === 'object' && !Array.isArray(value) && value.type) {
        const filterType = value.type
        const filterValue = value.value

        switch (filterType) {
          case 'eq':
            query = query.eq(key, filterValue)
            break
          case 'neq':
            query = query.neq(key, filterValue)
            break
          case 'gt':
            query = query.gt(key, filterValue)
            break
          case 'gte':
            query = query.gte(key, filterValue)
            break
          case 'lt':
            query = query.lt(key, filterValue)
            break
          case 'lte':
            query = query.lte(key, filterValue)
            break
          case 'like':
            query = query.like(key, `%${filterValue}%`)
            break
          case 'ilike':
            query = query.ilike(key, `%${filterValue}%`)
            break
          case 'in':
            if (Array.isArray(filterValue)) {
              query = query.in(key, filterValue)
            }
            break
          default:
            query = query.eq(key, filterValue)
        }
      } else {
        // Simple equality filter
        query = query.eq(key, value)
      }
    }

    const { data, error } = await query

    if (error) {
      // Provide more helpful error messages with full error details
      if (error.code === 'PGRST116') {
        return {
          data: null,
          error: `Table "${tableName}" does not exist or is not accessible. Please check the table name. Full error: ${error.message || JSON.stringify(error)}`
        }
      }
      if (error.message?.includes('permission denied')) {
        return {
          data: null,
          error: `Permission denied accessing table "${tableName}". Please check your Supabase RLS policies. Full error: ${error.message}`
        }
      }
      // Return detailed error for debugging
      return {
        data: null,
        error: `Query failed: ${error.message || JSON.stringify(error)}. Code: ${error.code || 'unknown'}`
      }
    }

    return { data: data || [], error: null }
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Query failed'
    }
  }
}

/**
 * Query a table with a join to a related table
 * This is useful when data is spread across multiple related tables
 * Example: queryTableWithJoin('t_materials', 't_material_prices', 'material_id') to get materials with their prices
 * 
 * Note: In Supabase PostgREST, joins work when:
 * - joinTable has a foreign key column pointing to tableName
 * - Syntax: joinTable!foreign_key_column(*) or joinTable(*) for auto-detection
 */
export async function queryTableWithJoin(
  tableName: string,
  joinTable: string,
  joinColumn?: string,
  filters: Record<string, any> = {},
  limit: number = 100
) {
  if (!supabaseAdmin) {
    return {
      data: null,
      error: 'Service role key not configured'
    }
  }

  // Try multiple join patterns
  const joinPatterns: string[] = []
  
  if (joinColumn) {
    // Pattern 1: Explicit foreign key: joinTable!joinColumn(*)
    joinPatterns.push(`${joinTable}!${joinColumn}(*)`)
    // Pattern 2: Try with table prefix removed from column name
    const columnWithoutPrefix = joinColumn.replace(/^.*_/, '')
    if (columnWithoutPrefix !== joinColumn) {
      joinPatterns.push(`${joinTable}!${columnWithoutPrefix}(*)`)
    }
  }
  
  // Pattern 3: Auto-detect (Supabase will try to find the relationship)
  joinPatterns.push(`${joinTable}(*)`)
  
  // Pattern 4: Try common foreign key naming patterns
  const commonFkNames = [
    `${tableName.replace('t_', '')}_id`,
    `id_${tableName.replace('t_', '')}`,
    `${tableName}_id`,
    'material_id',
    'product_id',
    'item_id'
  ]
  
  for (const fkName of commonFkNames) {
    if (fkName !== joinColumn) {
      joinPatterns.push(`${joinTable}!${fkName}(*)`)
    }
  }

  // Try each pattern until one works
  for (const joinSyntax of joinPatterns) {
    try {
      let query = supabaseAdmin
        .from(tableName)
        .select(`*, ${joinSyntax}`)
        .limit(limit)

      // Apply filters
      for (const [key, value] of Object.entries(filters)) {
        if (value === undefined || value === null) {
          continue
        }

        if (typeof value === 'object' && !Array.isArray(value) && value.type) {
          const filterType = value.type
          const filterValue = value.value

          switch (filterType) {
            case 'eq':
              query = query.eq(key, filterValue)
              break
            case 'neq':
              query = query.neq(key, filterValue)
              break
            case 'gt':
              query = query.gt(key, filterValue)
              break
            case 'gte':
              query = query.gte(key, filterValue)
              break
            case 'lt':
              query = query.lt(key, filterValue)
              break
            case 'lte':
              query = query.lte(key, filterValue)
              break
            case 'like':
              query = query.like(key, `%${filterValue}%`)
              break
            case 'ilike':
              query = query.ilike(key, `%${filterValue}%`)
              break
            case 'in':
              if (Array.isArray(filterValue)) {
                query = query.in(key, filterValue)
              }
              break
            default:
              query = query.eq(key, filterValue)
          }
        } else {
          query = query.eq(key, value)
        }
      }

      const { data, error } = await query

      if (!error && data) {
        return { data, error: null }
      }

      // If error, continue to next pattern unless it's a clear table-not-found error
      if (error && error.code === 'PGRST116') {
        // Table doesn't exist, no point trying other patterns
        return {
          data: null,
          error: `Table "${tableName}" or "${joinTable}" does not exist. Error: ${error.message}`
        }
      }
    } catch (err) {
      // Continue to next pattern
      continue
    }
  }

  // If all patterns failed, try querying from the other direction
  // Maybe we need to query from joinTable and join to tableName
  try {
    // Try reverse join: query from joinTable and join to tableName
    const reverseJoinPatterns = [
      `${tableName}(*)`,
      `${tableName}!${joinColumn || 'id'}(*)`
    ]

    for (const reverseJoin of reverseJoinPatterns) {
      try {
        let query = supabaseAdmin
          .from(joinTable)
          .select(`*, ${reverseJoin}`)
          .limit(limit)

        const { data, error } = await query
        if (!error && data) {
          return { data, error: null, note: 'Query executed from reverse direction' }
        }
      } catch (err) {
        continue
      }
    }
  } catch (err) {
    // Ignore reverse join errors
  }

  // All attempts failed
  return {
    data: null,
    error: `Failed to join "${tableName}" with "${joinTable}". Tried multiple join patterns. Possible issues: 1) Foreign key relationship not configured in Supabase, 2) Column names don't match expected patterns, 3) Tables don't have the expected relationship. Error details: Please check if "${joinTable}" has a foreign key column pointing to "${tableName}".`
  }
}

/**
 * Get projects with assigned staff members (always returns employee names, never IDs)
 * This function ensures consistent results with proper JOINs
 */
export async function getProjectsWithStaff(filters?: {
  plan_date?: string
  project_id?: string
  project_name?: string
}) {
  try {
    if (!supabaseAdmin) {
      return { data: null, error: 'Supabase admin client not initialized' }
    }

    // Build query with proper JOINs
    let query = supabaseAdmin
      .from('t_morningplan')
      .select(`
        plan_id,
        plan_date,
        start_time,
        service_type,
        notes,
        t_projects!inner (
          project_id,
          project_code,
          name,
          ort,
          dienstleistungen,
          notes
        ),
        t_vehicles (
          vehicle_id,
          name
        ),
        t_morningplan_staff!inner (
          role,
          individual_start_time,
          member_notes,
          t_employees!inner (
            employee_id,
            name,
            role,
            contract_type
          )
        )
      `)

    // Apply filters
    if (filters?.plan_date) {
      query = query.eq('plan_date', filters.plan_date)
    }
    if (filters?.project_id) {
      query = query.eq('project_id', filters.project_id)
    }
    if (filters?.project_name) {
      query = query.ilike('t_projects.name', `%${filters.project_name}%`)
    }

    const { data, error } = await query

    if (error) {
      return { data: null, error: error.message }
    }

    // Transform data into a more readable format
    const transformed = data?.map((plan: any) => ({
      plan_id: plan.plan_id,
      date: plan.plan_date,
      start_time: plan.start_time,
      service_type: plan.service_type,
      project: {
        id: plan.t_projects.project_id,
        code: plan.t_projects.project_code,
        name: plan.t_projects.name,
        location: plan.t_projects.ort,
        services: plan.t_projects.dienstleistungen,
        notes: plan.t_projects.notes,
      },
      vehicle: plan.t_vehicles ? {
        id: plan.t_vehicles.vehicle_id,
        name: plan.t_vehicles.name,
      } : null,
      staff: plan.t_morningplan_staff?.map((staff: any) => ({
        employee_id: staff.t_employees.employee_id,
        employee_name: staff.t_employees.name, // ALWAYS return name, never just ID
        role: staff.role,
        employee_role: staff.t_employees.role,
        contract_type: staff.t_employees.contract_type,
        start_time: staff.individual_start_time || plan.start_time,
        notes: staff.member_notes,
      })) || [],
      notes: plan.notes,
    }))

    return { data: transformed, error: null }
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Failed to get projects with staff'
    }
  }
}


