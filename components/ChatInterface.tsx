'use client'

import { useState, useRef, useEffect } from 'react'
import { Mic, MicOff, Volume2, Send, Loader2, Copy, Check, Trash2 } from 'lucide-react'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp?: Date
}

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [isPlayingAudio, setIsPlayingAudio] = useState(false)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Load chat history from localStorage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedMessages = localStorage.getItem('chat-history')
      if (savedMessages) {
        try {
          const parsed = JSON.parse(savedMessages)
          // Convert timestamp strings back to Date objects
          const messagesWithDates = parsed.map((msg: Message) => ({
            ...msg,
            timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
          }))
          setMessages(messagesWithDates)
        } catch (e) {
          console.error('Failed to load chat history:', e)
        }
      }
    }
  }, [])

  // Save chat history to localStorage whenever messages change
  useEffect(() => {
    if (typeof window !== 'undefined' && messages.length > 0) {
      localStorage.setItem('chat-history', JSON.stringify(messages))
    }
  }, [messages])

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
      // Check if we're in the browser (not SSR)
      if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        alert('This feature requires a browser environment. Please refresh the page.')
        return
      }

      // Check for getUserMedia support with fallbacks
      // Safari on macOS might need special handling
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent)
      
      // Check what's actually available
      const hasMediaDevices = navigator.mediaDevices !== undefined && navigator.mediaDevices !== null
      const hasMediaDevicesGetUserMedia = hasMediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'
      const hasWebkitGetUserMedia = typeof (navigator as any).webkitGetUserMedia === 'function'
      const hasNavigatorGetUserMedia = typeof (navigator as any).getUserMedia === 'function'
      const hasMozGetUserMedia = typeof (navigator as any).mozGetUserMedia === 'function'
      
      // If mediaDevices is undefined, try to polyfill it for Safari
      if (!hasMediaDevices && hasWebkitGetUserMedia) {
        // Safari might need a polyfill - try to create mediaDevices
        try {
          (navigator as any).mediaDevices = (navigator as any).mediaDevices || {}
          if (!(navigator as any).mediaDevices.getUserMedia && hasWebkitGetUserMedia) {
            (navigator as any).mediaDevices.getUserMedia = (constraints: MediaStreamConstraints) => {
              return new Promise<MediaStream>((resolve, reject) => {
                (navigator as any).webkitGetUserMedia(
                  constraints,
                  resolve,
                  reject
                )
              })
            }
            // Update the check
            const hasPolyfilled = typeof (navigator as any).mediaDevices.getUserMedia === 'function'
            if (hasPolyfilled) {
              console.log('Polyfilled navigator.mediaDevices.getUserMedia for Safari')
            }
          }
        } catch (e) {
          console.error('Failed to polyfill mediaDevices:', e)
        }
      }
      
      // Re-check after potential polyfill
      const hasMediaDevicesAfterPolyfill = navigator.mediaDevices !== undefined && navigator.mediaDevices !== null
      const hasMediaDevicesGetUserMediaAfterPolyfill = hasMediaDevicesAfterPolyfill && typeof navigator.mediaDevices.getUserMedia === 'function'
      
      if (!hasMediaDevicesGetUserMediaAfterPolyfill && !hasWebkitGetUserMedia && !hasNavigatorGetUserMedia && !hasMozGetUserMedia) {
        const userAgent = navigator.userAgent
        const isIOS = /iPad|iPhone|iPod/.test(userAgent)
        const isAndroid = /Android/.test(userAgent)
        const protocol = window.location.protocol
        const hostname = window.location.hostname
        const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
        const isSecure = protocol === 'https:' || isLocalhost
        
        // Detailed debugging
        const debugInfo = {
          hasMediaDevices: !!navigator.mediaDevices,
          hasMediaDevicesGetUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
          hasNavigatorGetUserMedia: !!(navigator as any).getUserMedia,
          hasWebkitGetUserMedia: !!(navigator as any).webkitGetUserMedia,
          hasMozGetUserMedia: !!(navigator as any).mozGetUserMedia,
          protocol,
          hostname,
          isLocalhost,
          isSecure,
          userAgent,
          navigatorKeys: Object.keys(navigator).filter(key => key.toLowerCase().includes('media') || key.toLowerCase().includes('user')),
        }
        console.error('getUserMedia not available:', debugInfo)
        console.error('Full navigator.mediaDevices:', navigator.mediaDevices)
        console.error('navigator.mediaDevices type:', typeof navigator.mediaDevices)
        
        let errorMsg = 'Your browser does not support microphone access.\n\n'
        
        // Only warn about HTTPS if it's not localhost
        if (!isSecure && !isLocalhost && protocol === 'http:') {
          errorMsg += '⚠️ IMPORTANT: Microphone access requires HTTPS or localhost.\n'
          errorMsg += `Current: ${protocol}//${hostname}\n\n`
        }
        
        if (isIOS) {
          errorMsg += 'On iOS, please:\n- Use Safari (iOS 11+)\n- Ensure you are using HTTPS or localhost\n- Check Safari settings → Websites → Microphone'
        } else if (isAndroid) {
          errorMsg += 'On Android, please use Chrome or Firefox and ensure microphone permissions are enabled.'
        } else {
          errorMsg += 'Please use a modern browser like Chrome, Firefox, or Safari.\n\n'
          errorMsg += 'If you are using Safari, make sure:\n- You are on Safari 11+\n- Microphone permissions are enabled in Safari settings'
        }
        errorMsg += `\n\nBrowser: ${userAgent}\nProtocol: ${protocol}\nHostname: ${hostname}`
        alert(errorMsg)
        return
      }

      // Check if MediaRecorder is available
      if (!window.MediaRecorder) {
        const userAgent = navigator.userAgent
        alert(`MediaRecorder is not supported in your browser.\n\nPlease use:\n- Chrome (desktop/mobile)\n- Firefox (desktop/mobile)\n- Safari (iOS 14.3+)\n\nCurrent browser: ${userAgent}`)
        return
      }

      // Request microphone access
      // Use the standard API directly - it should work in Safari 11+
      let stream: MediaStream
      
      // Re-check after potential polyfill
      const finalHasMediaDevices = navigator.mediaDevices !== undefined && navigator.mediaDevices !== null
      const finalHasMediaDevicesGetUserMedia = finalHasMediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function'
      
      if (finalHasMediaDevicesGetUserMedia) {
        // Modern standard API (Chrome, Firefox, Safari 11+)
        stream = await navigator.mediaDevices.getUserMedia({ 
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }
        })
      } else if (hasWebkitGetUserMedia) {
        // Safari fallback (older Safari)
        stream = await new Promise<MediaStream>((resolve, reject) => {
          (navigator as any).webkitGetUserMedia(
            { audio: true },
            resolve,
            reject
          )
        })
      } else if (hasNavigatorGetUserMedia) {
        // Other fallback
        stream = await new Promise<MediaStream>((resolve, reject) => {
          (navigator as any).getUserMedia(
            { audio: true },
            resolve,
            reject
          )
        })
      } else if (hasMozGetUserMedia) {
        // Firefox fallback
        stream = await new Promise<MediaStream>((resolve, reject) => {
          (navigator as any).mozGetUserMedia(
            { audio: true },
            resolve,
            reject
          )
        })
      } else {
        throw new Error('getUserMedia is not available')
      }

      // Detect mobile device
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

      // Try to find a supported MIME type (prioritize formats that work on mobile)
      let mimeType = ''
      const supportedTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/aac',
        'audio/ogg;codecs=opus',
        'audio/ogg',
      ]

      for (const type of supportedTypes) {
        if (MediaRecorder.isTypeSupported(type)) {
          mimeType = type
          break
        }
      }

      // For iOS/Safari, use browser default if no specific type is supported
      if (!mimeType && (isIOS || isSafari)) {
        mimeType = '' // Let browser choose
      }

      const mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)

      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onerror = (event: any) => {
        console.error('MediaRecorder error:', event.error)
        setIsRecording(false)
        stream.getTracks().forEach((track) => track.stop())
        alert('Recording error occurred. Please try again.')
      }

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())

        if (audioChunksRef.current.length === 0) {
          setIsRecording(false)
          alert('No audio recorded. Please try again.')
          return
        }

        // Create audio blob and send to STT API
        const actualMimeType = mediaRecorder.mimeType || audioChunksRef.current[0]?.type || 'audio/webm'
        const audioBlob = new Blob(audioChunksRef.current, {
          type: actualMimeType,
        })

        // Determine file extension based on MIME type
        let fileExtension = 'webm'
        if (actualMimeType.includes('mp4') || actualMimeType.includes('m4a')) {
          fileExtension = 'm4a'
        } else if (actualMimeType.includes('ogg')) {
          fileExtension = 'ogg'
        } else if (actualMimeType.includes('aac')) {
          fileExtension = 'aac'
        }

        try {
          const formData = new FormData()
          formData.append('audio', audioBlob, `recording.${fileExtension}`)

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
          console.error('Audio blob size:', audioBlob.size, 'Type:', actualMimeType)
          
          let errorMsg = 'Failed to transcribe audio. '
          if (error instanceof Error) {
            errorMsg += error.message
          } else {
            errorMsg += 'Unknown error'
          }
          
          // Provide helpful mobile-specific error messages
          if (isMobile) {
            errorMsg += '\n\nOn mobile devices, please ensure:\n- You have a stable internet connection\n- The recording was clear and not too short\n- Try speaking louder or closer to the microphone'
          }
          
          alert(errorMsg)
        } finally {
          setIsRecording(false)
        }
      }

      mediaRecorderRef.current = mediaRecorder
      
      // On mobile, use timeslices to ensure data is captured
      // Start with 1000ms timeslices (1 second chunks)
      if (isMobile) {
        mediaRecorder.start(1000)
      } else {
        mediaRecorder.start()
      }
      
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

  const copyToClipboard = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedIndex(index)
      setTimeout(() => setCopiedIndex(null), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }

  const clearChat = () => {
    if (confirm('Are you sure you want to clear the chat history?')) {
      setMessages([])
      if (typeof window !== 'undefined') {
        localStorage.removeItem('chat-history')
      }
    }
  }

  const formatTimestamp = (date: Date) => {
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const minutes = Math.floor(diff / 60000)
    
    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m ago`
    
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h ago`
    
    return date.toLocaleDateString('de-DE', { 
      day: 'numeric', 
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return

    const userMessage: Message = {
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
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
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])
    } catch (error) {
      console.error('Error sending message:', error)
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date(),
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
    <div className="flex flex-col h-screen bg-white safe-area-inset">
      {/* Header - Mobile optimized */}
      <div className="bg-white border-b border-gray-100 px-3 py-3 sm:px-4 sm:py-3 sticky top-0 z-10 safe-area-inset-top">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className="w-10 h-10 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center shadow-sm flex-shrink-0">
                <span className="text-white font-bold text-sm sm:text-base">LiS</span>
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-base sm:text-lg font-semibold text-gray-900 truncate">
                  LiS Chatbot
                </h1>
                <p className="text-[11px] sm:text-xs text-gray-500 truncate">
                  Ask questions with text or voice
                </p>
              </div>
            </div>
            {messages.length > 0 && (
              <button
                onClick={clearChat}
                className="p-2.5 sm:p-2 rounded-lg text-gray-500 active:text-red-600 active:bg-red-50 transition-colors touch-manipulation flex-shrink-0 ml-2"
                title="Clear chat history"
                aria-label="Clear chat history"
              >
                <Trash2 className="h-5 w-5 sm:h-5 sm:w-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Messages - Mobile optimized scrolling */}
      <div className="flex-1 overflow-y-auto bg-gray-50 px-3 py-4 sm:px-4 sm:py-5 overscroll-contain">
        <div className="max-w-3xl mx-auto space-y-3 sm:space-y-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full min-h-[50vh] text-center px-4 py-8">
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-xl bg-blue-50 flex items-center justify-center mb-4">
                <Mic className="h-8 w-8 sm:h-10 sm:w-10 text-blue-600" />
              </div>
              <h2 className="text-lg sm:text-xl font-semibold text-gray-900 mb-2">
                Start a conversation
              </h2>
              <p className="text-sm sm:text-base text-gray-600 max-w-sm leading-relaxed">
                Type a message or use the microphone to speak. I can help you query your Supabase database!
              </p>
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={index}
              className={`flex ${
                message.role === 'user' ? 'justify-end' : 'justify-start'
              } animate-in fade-in slide-in-from-bottom-2 duration-200 group`}
            >
              <div
                className={`max-w-[90%] sm:max-w-[75%] rounded-2xl sm:rounded-xl px-4 py-3 sm:px-4 sm:py-2.5 relative ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-white text-gray-900 rounded-bl-sm border border-gray-200 shadow-sm'
                }`}
              >
                <div className="flex items-start justify-between gap-2.5">
                  <p className="whitespace-pre-wrap text-[15px] sm:text-[15px] leading-relaxed flex-1 break-words">
                    {message.content}
                  </p>
                  <button
                    onClick={() => copyToClipboard(message.content, index)}
                    className={`opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity p-2 sm:p-1 rounded-lg touch-manipulation active:scale-95 ${
                      message.role === 'user'
                        ? 'active:bg-blue-700 text-white'
                        : 'active:bg-gray-100 text-gray-600'
                    }`}
                    title="Copy message"
                    aria-label="Copy message"
                  >
                    {copiedIndex === index ? (
                      <Check className="h-4 w-4 sm:h-4 sm:w-4" />
                    ) : (
                      <Copy className="h-4 w-4 sm:h-4 sm:w-4" />
                    )}
                  </button>
                </div>
                {message.timestamp && (
                  <p
                    className={`text-[11px] sm:text-xs mt-2 sm:mt-1.5 ${
                      message.role === 'user'
                        ? 'text-blue-100'
                        : 'text-gray-400'
                    }`}
                  >
                    {formatTimestamp(message.timestamp)}
                  </p>
                )}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex justify-start animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="bg-white rounded-2xl sm:rounded-xl rounded-bl-sm px-4 py-3 sm:px-4 sm:py-2.5 border border-gray-200 shadow-sm">
                <div className="flex items-center gap-2.5">
                  <Loader2 className="animate-spin h-4 w-4 sm:h-4 sm:w-4 text-blue-600" />
                  <span className="text-sm sm:text-sm text-gray-600">Thinking...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area - Mobile optimized with larger touch targets */}
      <div className="bg-white border-t border-gray-100 px-3 py-3 sm:px-4 sm:py-3 safe-area-inset-bottom">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-end gap-2.5 sm:gap-2">
            <div className="flex-1 relative">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Type your message..."
                className="w-full p-3 sm:p-3 pr-14 sm:pr-12 pb-10 sm:pb-8 border-2 border-gray-200 rounded-xl sm:rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white text-gray-900 placeholder-gray-400 text-[16px] sm:text-[15px] transition-all"
                rows={1}
                style={{ minHeight: '48px', maxHeight: '120px' }}
              />
              <div className="absolute bottom-2 right-3 sm:bottom-1.5 sm:right-2 flex items-center gap-2">
                <span className="text-[11px] sm:text-xs text-gray-400">
                  {input.length} / 2000
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-1.5 flex-shrink-0">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={isLoading}
                className={`p-3 sm:p-2.5 rounded-xl sm:rounded-lg transition-all duration-150 touch-manipulation active:scale-95 ${
                  isRecording
                    ? 'bg-red-500 text-white animate-pulse'
                    : 'bg-gray-100 text-gray-700 active:bg-gray-200'
                } disabled:opacity-50 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center`}
                title={isRecording ? 'Stop recording' : 'Start voice input'}
                aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
              >
                {isRecording ? (
                  <MicOff className="h-5 w-5 sm:h-5 sm:w-5" />
                ) : (
                  <Mic className="h-5 w-5 sm:h-5 sm:w-5" />
                )}
              </button>

              {messages.length > 0 && (
                <button
                  onClick={isPlayingAudio ? stopSpeaking : playLastResponse}
                  disabled={isLoading}
                  className={`p-3 sm:p-2.5 rounded-xl sm:rounded-lg transition-all duration-150 touch-manipulation active:scale-95 ${
                    isPlayingAudio
                      ? 'bg-green-500 text-white'
                      : 'bg-gray-100 text-gray-700 active:bg-gray-200'
                  } disabled:opacity-50 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center`}
                  title={isPlayingAudio ? 'Stop audio' : 'Play last response as audio'}
                  aria-label={isPlayingAudio ? 'Stop audio' : 'Play last response as audio'}
                >
                  <Volume2 className="h-5 w-5 sm:h-5 sm:w-5" />
                </button>
              )}

              <button
                onClick={sendMessage}
                disabled={!input.trim() || isLoading}
                className="p-3 sm:p-2.5 bg-blue-600 active:bg-blue-700 text-white rounded-xl sm:rounded-lg transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation active:scale-95 shadow-sm active:shadow min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
                title="Send message"
                aria-label="Send message"
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 sm:h-5 sm:w-5 animate-spin" />
                ) : (
                  <Send className="h-5 w-5 sm:h-5 sm:w-5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


