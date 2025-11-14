'use client'

import { useState, useRef, useEffect } from 'react'
import { Mic, MicOff, Volume2, Send, Loader2 } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isPlayingAudio, setIsPlayingAudio] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
    }
  }, [])

  const startRecording = async () => {
    if (isRecording) return

    try {
      // Check if getUserMedia is available
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        alert('Your browser does not support microphone access. Please use a modern browser like Chrome, Firefox, or Safari.')
        return
      }

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        }
      })

      // Try to find a supported MIME type
      let mimeType = 'audio/webm;codecs=opus'
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'audio/webm'
        if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'audio/mp4'
          if (!MediaRecorder.isTypeSupported(mimeType)) {
            mimeType = '' // Use browser default
          }
        }
      }

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())

        if (audioChunksRef.current.length === 0) {
          setIsRecording(false)
          return
        }

        // Create audio blob and send to STT API
        const audioBlob = new Blob(audioChunksRef.current, {
          type: mediaRecorder.mimeType || 'audio/webm',
        })

        try {
          const formData = new FormData()
          formData.append('audio', audioBlob, 'recording.webm')

          const response = await fetch('/api/stt', {
            method: 'POST',
            body: formData,
          })

          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}))
            throw new Error(errorData.error || 'Failed to transcribe audio')
          }

          const data = await response.json()
          if (data.transcript) {
            setInput(data.transcript)
          } else {
            alert('No speech detected. Please try speaking again.')
          }
        } catch (error) {
          console.error('STT error:', error)
          alert(`Failed to transcribe audio: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`)
        } finally {
          setIsRecording(false)
        }
      }

      mediaRecorderRef.current = mediaRecorder
      mediaRecorder.start()
      setIsRecording(true)
    } catch (error: any) {
      console.error('Error accessing microphone:', error)
      setIsRecording(false)
      
      let errorMessage = 'Microphone access denied.'
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage = 'Microphone permission denied. Please:\n\n1. Click the lock icon in your browser\'s address bar\n2. Allow microphone access\n3. Refresh the page and try again\n\nOr check your system settings to allow microphone access for your browser.'
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        errorMessage = 'No microphone found. Please connect a microphone and try again.'
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        errorMessage = 'Microphone is already in use by another application. Please close other apps using the microphone and try again.'
      } else if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
        errorMessage = 'Microphone constraints could not be satisfied. Please try again.'
      }
      
      alert(errorMessage)
    }
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop()
      // setIsRecording will be set to false in onstop handler
    }
  }

  const speakText = async (text: string) => {
    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
      setIsPlayingAudio(false)
    }

    try {
      // Call TTS API
      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text }),
      })

      if (!response.ok) {
        throw new Error('Failed to generate speech')
      }

      // Get audio blob
      const audioBlob = await response.blob()
      const audioUrl = URL.createObjectURL(audioBlob)

      // Create audio element and play
      const audio = new Audio(audioUrl)
      audioRef.current = audio

      audio.onplay = () => setIsPlayingAudio(true)
      audio.onended = () => {
        setIsPlayingAudio(false)
        URL.revokeObjectURL(audioUrl)
        audioRef.current = null
      }
      audio.onerror = () => {
        setIsPlayingAudio(false)
        URL.revokeObjectURL(audioUrl)
        audioRef.current = null
      }

      await audio.play()
    } catch (error) {
      console.error('TTS error:', error)
      alert('Failed to play audio. Please try again.')
      setIsPlayingAudio(false)
    }
  }

  const stopSpeaking = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
      setIsPlayingAudio(false)
    }
  }

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get response')
      }

      const data = await response.json()
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message.content,
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error('Error sending message:', error)
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`
    }
  }, [input])

  const playLastResponse = () => {
    const lastAssistantMessage = [...messages]
      .reverse()
      .find((m) => m.role === 'assistant')

    if (lastAssistantMessage) {
      speakText(lastAssistantMessage.content)
    }
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-3 py-2.5 sm:px-4 sm:py-3 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm">
              <span className="text-white font-bold text-sm sm:text-base">LiS</span>
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-semibold text-gray-900">
                LiS Chatbot
              </h1>
              <p className="text-[11px] sm:text-xs text-gray-500">
                Ask questions with text or voice
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto bg-gray-50 px-3 py-4 sm:px-4 sm:py-5">
        <div className="max-w-3xl mx-auto space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full min-h-[40vh] text-center px-4">
              <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl bg-blue-50 flex items-center justify-center mb-3">
                <Mic className="h-7 w-7 sm:h-8 sm:w-8 text-blue-600" />
              </div>
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-1.5">
                Start a conversation
              </h2>
              <p className="text-xs sm:text-sm text-gray-600 max-w-sm">
                Type a message or use the microphone to speak. I can help you query your Supabase database!
              </p>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              } animate-in fade-in slide-in-from-bottom-2 duration-200`}
            >
              <div
                className={`max-w-[85%] sm:max-w-[75%] rounded-xl px-3 py-2 sm:px-4 sm:py-2.5 ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-white text-gray-900 rounded-bl-sm border border-gray-200 shadow-sm'
                }`}
              >
                <p className="whitespace-pre-wrap text-sm sm:text-[15px] leading-relaxed">
                  {message.content}
                </p>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="bg-white rounded-xl rounded-bl-sm px-3 py-2 sm:px-4 sm:py-2.5 border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2">
                  <Loader2 className="animate-spin h-3.5 w-3.5 sm:h-4 sm:w-4 text-blue-600" />
                  <span className="text-xs sm:text-sm text-gray-600">Thinking...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="bg-white border-t border-gray-100 px-3 py-2.5 sm:px-4 sm:py-3 safe-area-inset-bottom">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your message..."
                className="w-full p-2.5 sm:p-3 pr-12 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 placeholder-gray-400 text-sm sm:text-[15px] transition-all"
                rows={1}
                style={{ minHeight: '40px', maxHeight: '120px' }}
              />
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isLoading}
                className={`p-2 sm:p-2.5 rounded-lg transition-all duration-150 ${
                  isRecording
                    ? 'bg-red-500 text-white animate-pulse'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300'
                } disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation`}
                title={isRecording ? 'Stop recording' : 'Start voice input'}
                aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
              >
                {isRecording ? (
                  <MicOff className="h-4 w-4 sm:h-5 sm:w-5" />
                ) : (
                  <Mic className="h-4 w-4 sm:h-5 sm:w-5" />
                )}
              </button>

              {messages.length > 0 && (
                <button
                  onClick={isPlayingAudio ? stopSpeaking : playLastResponse}
                  disabled={isLoading}
                  className={`p-2 sm:p-2.5 rounded-lg transition-all duration-150 ${
                    isPlayingAudio
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300'
                  } disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation`}
                  title={isPlayingAudio ? 'Stop audio' : 'Play last response as audio'}
                  aria-label={isPlayingAudio ? 'Stop audio' : 'Play last response as audio'}
                >
                  <Volume2 className="h-4 w-4 sm:h-5 sm:w-5" />
                </button>
              )}

              <button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="p-2 sm:p-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white rounded-lg transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation shadow-sm hover:shadow"
                title="Send message"
                aria-label="Send message"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 sm:h-5 sm:w-5 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 sm:h-5 sm:w-5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


