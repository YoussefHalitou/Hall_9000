import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables')
}

// Client for client-side operations
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Admin client for server-side operations (with service role key)
export const supabaseAdmin = supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null

/**
 * Get database schema information
 */
export async function getDatabaseSchema() {
  try {
    // Query information_schema to get table and column information
    const { data, error } = await supabase.rpc('get_schema_info')

    if (error) {
      // Fallback: return empty schema if RPC doesn't exist
      return {
        tables: [],
        error: 'Schema query not available. RPC function may not exist.'
      }
    }

    return { tables: data || [], error: null }
  } catch (err) {
    // Fallback: try to get schema via direct query if RPC doesn't exist
    // This is a simplified approach - in production, you might want to create a proper RPC function
    return {
      tables: [],
      error: err instanceof Error ? err.message : 'Unknown error'
    }
  }
}

/**
 * Execute a read-only SQL query
 */
export async function executeQuery(query: string) {
  try {
    // Use the admin client for raw SQL queries
    if (!supabaseAdmin) {
      throw new Error('Service role key not configured for SQL queries')
    }

    // Supabase doesn't directly support raw SQL via the JS client
    // We'll need to use REST API or create RPC functions
    // For now, we'll return an error suggesting RPC functions
    throw new Error('Direct SQL execution not available. Please use Supabase RPC functions or REST API.')
  } catch (err) {
    throw err
  }
}

/**
 * Execute a query using Supabase RPC (recommended approach)
 */
export async function executeRPC(functionName: string, params: Record<string, any> = {}) {
  try {
    if (!supabaseAdmin) {
      throw new Error('Service role key not configured')
    }

    const { data, error } = await supabaseAdmin.rpc(functionName, params)

    if (error) {
      throw error
    }

    return { data, error: null }
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : 'Unknown error'
    }
  }
}

