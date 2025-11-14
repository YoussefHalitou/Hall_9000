import { NextRequest, NextResponse } from 'next/server'

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM' // Default voice: Rachel

if (!ELEVENLABS_API_KEY) {
  throw new Error('ELEVENLABS_API_KEY is not set')
}

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json()

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      )
    }

    // Call ElevenLabs TTS API
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'Content-Type': 'application/json',
          'xi-api-key': ELEVENLABS_API_KEY,
        },
        body: JSON.stringify({
          text: text,
          model_id: 'eleven_multilingual_v2', // Supports multiple languages including German
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    )

    if (!response.ok) {
      const error = await response.text()
      console.error('ElevenLabs TTS error:', error)
      return NextResponse.json(
        { error: 'Failed to generate speech' },
        { status: response.status }
      )
    }

    // Get audio data as ArrayBuffer
    const audioBuffer = await response.arrayBuffer()

    // Return audio as base64 or stream
    return new NextResponse(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': audioBuffer.byteLength.toString(),
      },
    })
  } catch (error) {
    console.error('TTS API error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'An error occurred',
      },
      { status: 500 }
    )
  }
}

