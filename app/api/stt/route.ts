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

    // Determine content type - Deepgram needs the correct MIME type
    let contentType = audioFile.type
    if (!contentType) {
      // Try to infer from filename or default to webm
      const fileName = audioFile.name.toLowerCase()
      if (fileName.endsWith('.m4a') || fileName.endsWith('.mp4')) {
        contentType = 'audio/mp4'
      } else if (fileName.endsWith('.ogg')) {
        contentType = 'audio/ogg'
      } else if (fileName.endsWith('.aac')) {
        contentType = 'audio/aac'
      } else {
        contentType = 'audio/webm' // Default
      }
    }

    // Call Deepgram API directly
    // Deepgram supports various audio formats: webm, mp4, m4a, ogg, wav, etc.
    const response = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=de&smart_format=true&punctuate=true', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${DEEPGRAM_API_KEY}`,
        'Content-Type': contentType,
      },
      body: audioBuffer,
    })

    if (!response.ok) {
      const error = await response.text()
      console.error('Deepgram STT error:', {
        status: response.status,
        statusText: response.statusText,
        error: error,
        contentType: contentType,
        fileSize: audioBuffer.byteLength,
      })
      
      let errorMessage = 'Failed to transcribe audio'
      if (response.status === 400) {
        errorMessage = 'Invalid audio format. Please try recording again.'
      } else if (response.status === 401) {
        errorMessage = 'Deepgram API authentication failed. Please check your API key.'
      } else if (response.status === 413) {
        errorMessage = 'Audio file is too large. Please record a shorter message.'
      }
      
      return NextResponse.json(
        { error: errorMessage, details: error },
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

