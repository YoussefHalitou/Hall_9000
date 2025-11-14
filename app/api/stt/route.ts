import { NextRequest, NextResponse } from 'next/server'

const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY

if (!DEEPGRAM_API_KEY) {
  throw new Error('DEEPGRAM_API_KEY is not set')
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const audioFile = formData.get('audio') as File

    if (!audioFile) {
      return NextResponse.json(
        { error: 'Audio file is required' },
        { status: 400 }
      )
    }

    // Convert File to ArrayBuffer
    const audioBuffer = await audioFile.arrayBuffer()

    // Call Deepgram API directly
    // Deepgram supports various audio formats including webm
    const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=de&smart_format=true&punctuate=true', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': audioFile.type || 'audio/webm',
      },
      body: audioBuffer,
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Deepgram STT error:', error)
      return NextResponse.json(
        { error: 'Failed to transcribe audio' },
        { status: response.status }
      )
    }

    const data = await response.json()

    // Extract transcript
    const transcript =
      data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || ''

    if (!transcript) {
      return NextResponse.json(
        { error: 'No speech detected' },
        { status: 400 }
      )
    }

    return NextResponse.json({ transcript })
  } catch (error) {
    console.error('STT API error:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'An error occurred',
      },
      { status: 500 }
    )
  }
}

