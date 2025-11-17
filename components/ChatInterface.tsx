'use client'

import { useState, useRef, useEffect } from 'react'
import { Mic, MicOff, Volume2, Send, Loader2, Copy, Check, Trash2, X } from 'lucide-react'

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
  const [voiceOnlyMode, setVoiceOnlyMode] = useState(false)
  const [isProcessingVoice, setIsProcessingVoice] = useState(false)
  const [audioLevel, setAudioLevel] = useState(0)
  const [silenceStartTime, setSilenceStartTime] = useState<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const silenceStartTimeRef = useRef<number | null>(null)
  const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
        alert('Diese Funktion benötigt eine Browser-Umgebung. Bitte lade die Seite neu.')
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
        
        let errorMsg = 'Dein Browser erlaubt aktuell keinen Mikrofonzugriff.\n\n'
        
        // Only warn about HTTPS if it's not localhost
        if (!isSecure && !isLocalhost && protocol === 'http:') {
          errorMsg += '⚠️ Wichtig: Mikrofonzugriff funktioniert nur über HTTPS oder auf localhost.\n'
          errorMsg += `Aktuell: ${protocol}//${hostname}\n\n`
        }
        
        if (isIOS) {
          errorMsg += 'Für iOS gilt:\n- Verwende Safari (ab iOS 11)\n- Nutze HTTPS oder localhost\n- Prüfe in Safari unter Einstellungen → Websites → Mikrofon'
        } else if (isAndroid) {
          errorMsg += 'Für Android gilt: Verwende Chrome oder Firefox und erlaube den Mikrofonzugriff.'
        } else {
          errorMsg += 'Bitte nutze einen modernen Browser wie Chrome, Firefox oder Safari.\n\n'
          errorMsg += 'Falls du Safari verwendest:\n- Stelle sicher, dass du Safari 11+ nutzt\n- Aktiviere die Mikrofonberechtigung in den Safari-Einstellungen'
        }
        errorMsg += `\n\nBrowser: ${userAgent}\nProtokoll: ${protocol}\nHostname: ${hostname}`
        alert(errorMsg)
        return
      }

      // Check if MediaRecorder is available
      if (!window.MediaRecorder) {
        const userAgent = navigator.userAgent
        alert(`Der MediaRecorder wird von deinem Browser nicht unterstützt.\n\nNutze bitte:\n- Chrome (Desktop/Mobil)\n- Firefox (Desktop/Mobil)\n- Safari (iOS 14.3+)\n\nAktueller Browser: ${userAgent}`)
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
      
      // Start audio monitoring for voice-only mode
      if (voiceOnlyMode) {
        startAudioMonitoring(stream)
      }

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onerror = (event: any) => {
        console.error('MediaRecorder error:', event.error)
        setIsRecording(false)
        stream.getTracks().forEach((track) => track.stop())
        alert('Bei der Aufnahme ist ein Fehler aufgetreten. Bitte versuch es erneut.')
      }

      mediaRecorder.onstop = async () => {
        // Stop audio monitoring
        stopAudioMonitoring()
        stream.getTracks().forEach((track) => track.stop())
        streamRef.current = null

        console.log('[STT] MediaRecorder stopped, chunks collected:', audioChunksRef.current.length)

        if (audioChunksRef.current.length === 0) {
          console.warn('[STT] No audio chunks recorded')
          setIsRecording(false)
          if (!voiceOnlyMode) {
            alert('Es wurde kein Audio aufgezeichnet. Bitte versuch es erneut.')
          }
          // In voice-only mode, restart recording if no audio was captured
          if (voiceOnlyMode) {
            setTimeout(() => {
              if (voiceOnlyMode && !isRecording) {
                startRecording()
              }
            }, 500)
          }
          return
        }

        // Create audio blob and send to STT API
        const actualMimeType = mediaRecorder.mimeType || audioChunksRef.current[0]?.type || 'audio/webm'
        const audioBlob = new Blob(audioChunksRef.current, {
          type: actualMimeType,
        })

        console.log('[STT] Audio blob created:', { 
          size: audioBlob.size, 
          type: actualMimeType,
          chunks: audioChunksRef.current.length 
        })

        // Check if blob is too small (likely no actual audio)
        if (audioBlob.size < 100) {
          console.warn('[STT] Audio blob too small, likely no audio captured')
          setIsRecording(false)
          if (!voiceOnlyMode) {
            alert('Die Aufnahme war zu kurz. Bitte versuch es erneut.')
          }
          if (voiceOnlyMode) {
            setTimeout(() => {
              if (voiceOnlyMode && !isRecording) {
                startRecording()
              }
            }, 500)
          }
          return
        }

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
          setIsProcessingVoice(true)
          const formData = new FormData()
          formData.append('audio', audioBlob, `recording.${fileExtension}`)

          const maxSttAttempts = 2
          let sttResponse: Response | null = null
          let sttError: Error | null = null

          for (let attempt = 0; attempt < maxSttAttempts; attempt++) {
            try {
              const candidate = await fetch('/api/stt', {
                method: 'POST',
                body: formData,
              })

              if (candidate.ok) {
                sttResponse = candidate
                break
              } else {
                const errorData = await candidate.json().catch(() => ({}))
                sttError = new Error(errorData.error || `STT-Fehler (${candidate.status})`)
              }
            } catch (err) {
              sttError = err instanceof Error ? err : new Error('Unbekannter STT-Fehler')
            }

            if (attempt < maxSttAttempts - 1) {
              await delay(350)
            }
          }

          if (!sttResponse) {
            throw (sttError || new Error('Die Spracherkennung ist fehlgeschlagen.'))
          }

          const data = await sttResponse.json()
          if (data.transcript) {
            // In voice-only mode, automatically send the message and get response
            if (voiceOnlyMode) {
              await handleVoiceOnlyMessage(data.transcript)
            } else {
              // Normal mode: just set the input
              setInput(data.transcript)
            }
          } else {
            if (!voiceOnlyMode) {
              alert('Es wurde keine Sprache erkannt. Bitte sprich noch einmal.')
            }
            // In voice-only mode, restart recording
            if (voiceOnlyMode) {
              setTimeout(() => {
                if (voiceOnlyMode && !isRecording) {
                  startRecording()
                }
              }, 500)
            }
          }
        } catch (error) {
          console.error('STT error:', error)
          console.error('Audio blob size:', audioBlob.size, 'Type:', actualMimeType)
          
          let errorMsg = 'Die Spracherkennung ist fehlgeschlagen. '
          if (error instanceof Error) {
            errorMsg += error.message
          } else {
            errorMsg += 'Unbekannter Fehler'
          }
          
          // Provide helpful mobile-specific error messages
          if (isMobile) {
            errorMsg += '\n\nAuf mobilen Geräten gilt:\n- Stelle eine stabile Internetverbindung sicher\n- Die Aufnahme sollte klar und nicht zu kurz sein\n- Sprich lauter oder näher am Mikrofon'
          }
          
          if (!voiceOnlyMode) {
            alert(errorMsg)
          }
          
          // In voice-only mode, restart recording after error
          if (voiceOnlyMode) {
            setTimeout(() => {
              if (voiceOnlyMode && !isRecording) {
                startRecording()
              }
            }, 1000)
          }
        } finally {
          setIsRecording(false)
          setIsProcessingVoice(false)
        }
      }

      mediaRecorderRef.current = mediaRecorder
      
      // Always use timeslices to ensure data is captured reliably
      // This prevents the "first recording fails" issue where ondataavailable
      // doesn't fire if recording is stopped too quickly
      // Use 250ms timeslices for better responsiveness and reliability
      console.log('[STT] Starting MediaRecorder with 250ms timeslices')
      mediaRecorder.start(250)
      
      setIsRecording(true)
    } catch (error: any) {
      console.error('Error accessing microphone:', error)
      setIsRecording(false)
      
      let errorMessage = 'Der Mikrofonzugriff wurde verweigert.'
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage = 'Der Mikrofonzugriff wurde blockiert. Bitte:\n\n1. Klicke auf das Schloss-Symbol in der Adressleiste\n2. Erlaube den Mikrofonzugriff\n3. Lade die Seite neu\n\nPrüfe ggf. auch die Systemeinstellungen deines Geräts.'
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        errorMessage = 'Es wurde kein Mikrofon gefunden. Bitte verbinde ein Mikrofon und versuche es erneut.'
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        errorMessage = 'Das Mikrofon wird bereits von einer anderen Anwendung verwendet. Schließe diese Anwendung und versuche es erneut.'
      } else if (error.name === 'OverconstrainedError' || error.name === 'ConstraintNotSatisfiedError') {
        errorMessage = 'Die Mikrofoneinstellungen konnten nicht übernommen werden. Bitte versuche es erneut.'
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

  const formatTextForSpeech = (text: string) => {
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    const bulletRegex = /^(\d+\.|[-*•])\s+/
    const bulletLines = lines.filter((line) => bulletRegex.test(line))

    if (bulletLines.length >= 2 && bulletLines.length >= lines.length / 2) {
      return bulletLines
        .map((line, index) => {
          const cleanLine = line.replace(bulletRegex, '')
          return `Punkt ${index + 1}: ${cleanLine}`
        })
        .join('. ')
    }

    return lines.join('. ')
  }

  const speakText = async (text: string) => {
    // Stop any currently playing audio
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
      setIsPlayingAudio(false)
    }

    let audioUrl: string | null = null

    try {
      // Set loading state immediately for better UX
      setIsPlayingAudio(true)
      
      const preparedText = formatTextForSpeech(text)

      const maxTtsAttempts = 2
      let ttsResponse: Response | null = null
      let ttsError: Error | null = null

      for (let attempt = 0; attempt < maxTtsAttempts; attempt++) {
        try {
          const candidate = await fetch('/api/tts', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ text: preparedText }),
          })

          if (candidate.ok) {
            ttsResponse = candidate
            break
          } else {
            const errorText = await candidate.text().catch(() => 'Unbekannter Fehler')
            ttsError = new Error(`TTS-Fehler (${candidate.status}): ${errorText}`)
          }
        } catch (err) {
          ttsError = err instanceof Error ? err : new Error('Unbekannter TTS-Fehler')
        }

        if (attempt < maxTtsAttempts - 1) {
          await delay(300)
        }
      }

      if (!ttsResponse) {
        throw (ttsError || new Error('Die Audioausgabe konnte nicht erzeugt werden.'))
      }

      // Convert response to blob URL
      const audioBlob = await ttsResponse.blob()
      audioUrl = URL.createObjectURL(audioBlob)

      // Create audio element immediately and start loading
      const audio = new Audio()
      audioRef.current = audio
      
      // Store URL for cleanup
      const urlToCleanup = audioUrl
      
      // Set up event handlers before setting source
      audio.onplay = () => {
        setIsPlayingAudio(true)
      }
      
      audio.onended = () => {
        setIsPlayingAudio(false)
        const wasVoiceOnly = voiceOnlyMode
        audioRef.current = null
        if (urlToCleanup) {
          URL.revokeObjectURL(urlToCleanup)
        }
        
        // In voice-only mode, restart recording after audio finishes
        if (wasVoiceOnly && !isRecording && !isLoading) {
          setTimeout(() => {
            if (voiceOnlyMode && !isRecording && !isLoading) {
              startRecording()
            }
          }, 500)
        }
      }
      
      audio.onerror = (e) => {
        console.error('Audio playback error:', e, {
          error: audio.error,
          networkState: audio.networkState,
          readyState: audio.readyState,
          src: audio.src
        })
        setIsPlayingAudio(false)
        audioRef.current = null
        if (urlToCleanup) {
          URL.revokeObjectURL(urlToCleanup)
        }
        // Don't show alert in voice-only mode to avoid interrupting flow
        if (!voiceOnlyMode) {
          alert('Audio konnte nicht abgespielt werden. Bitte versuch es erneut.')
        }
      }
      
      // Set source and preload
      audio.src = audioUrl
      audio.preload = 'auto'
      // Ensure consistent playback speed (1.0 = normal speed)
      audio.playbackRate = 1.0
      
      console.log('[TTS] Audio element created, attempting to play...', {
        readyState: audio.readyState,
        src: audioUrl.substring(0, 50) + '...'
      })
      
      // Simplified playback logic - just try to play, with one retry on failure
      let playAttempted = false
      
      const attemptPlay = async () => {
        if (playAttempted) {
          console.log('[TTS] Play already attempted, skipping duplicate')
          return
        }
        playAttempted = true
        
        console.log('[TTS] Attempting to play audio...', { readyState: audio.readyState })
        
        try {
          await audio.play()
          console.log('[TTS] Audio playing successfully')
        } catch (playError: any) {
          console.error('[TTS] Play error:', playError)
          
          // Handle play errors gracefully
          if (playError.name === 'NotAllowedError') {
            console.error('[TTS] Audio play blocked by browser autoplay policy')
            setIsPlayingAudio(false)
            audioRef.current = null
            if (urlToCleanup) {
              URL.revokeObjectURL(urlToCleanup)
            }
            if (!voiceOnlyMode) {
              alert('Die Audiowiedergabe wurde vom Browser blockiert. Bitte interagiere zuerst mit der Seite (z.B. ein Klick).')
            }
          } else {
            // For other errors, wait a bit and try once more
            console.log('[TTS] Retrying playback after brief delay...')
            setTimeout(async () => {
              try {
                await audio.play()
                console.log('[TTS] Audio playing successfully after retry')
              } catch (retryError) {
                console.error('[TTS] Audio play retry failed:', retryError)
                setIsPlayingAudio(false)
                audioRef.current = null
                if (urlToCleanup) {
                  URL.revokeObjectURL(urlToCleanup)
                }
                if (!voiceOnlyMode) {
                  alert('Audio konnte nicht abgespielt werden. Bitte versuch es erneut.')
                }
              }
            }, 200)
          }
        }
      }
      
      // Try to play as soon as enough data is loaded
      if (audio.readyState >= 3) {
        // HAVE_FUTURE_DATA or higher - enough to start playing
        attemptPlay()
      } else {
        // Wait for canplay event (HAVE_FUTURE_DATA)
        audio.addEventListener('canplay', attemptPlay, { once: true })
      }
    } catch (error) {
      console.error('TTS error:', error)
      setIsPlayingAudio(false)
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl)
      }
      if (audioRef.current) {
        audioRef.current = null
      }
      // Don't show alert in voice-only mode
      if (!voiceOnlyMode) {
        alert('Audio konnte nicht erzeugt oder abgespielt werden. Bitte versuch es erneut.')
      }
    }
  }

  const stopSpeaking = () => {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
      setIsPlayingAudio(false)
      
      // In voice-only mode, restart recording after interrupting
      if (voiceOnlyMode && !isRecording && !isLoading) {
        setTimeout(() => {
          if (voiceOnlyMode && !isRecording && !isLoading) {
            startRecording()
          }
        }, 300)
      }
    }
  }

  // Voice Activity Detection - monitor audio levels
  const startAudioMonitoring = (stream: MediaStream) => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      const analyser = audioContext.createAnalyser()
      const microphone = audioContext.createMediaStreamSource(stream)
      
      analyser.fftSize = 2048 // Larger FFT for better time domain analysis
      analyser.smoothingTimeConstant = 0.3 // Less smoothing for more responsive detection
      microphone.connect(analyser)
      
      audioContextRef.current = audioContext
      analyserRef.current = analyser
      streamRef.current = stream
      silenceStartTimeRef.current = null // Reset silence timer
      
      const dataArray = new Uint8Array(analyser.fftSize)
      const silenceDuration = 2000 // 2 seconds of silence to auto-stop
      
      // Dynamic threshold: measure background noise first
      let backgroundNoiseLevel = 0
      let samplesCollected = 0
      const calibrationSamples = 30 // Collect 30 samples (~0.5 seconds) to determine background
      let hasDetectedSpeech = false // Track if we've detected any speech
      
      const monitorAudio = () => {
        if (!analyserRef.current || !voiceOnlyMode || !isRecording) {
          return
        }
        
        // Use getByteTimeDomainData for amplitude-based VAD (better for speech detection)
        analyserRef.current.getByteTimeDomainData(dataArray)
        
        // Calculate RMS (Root Mean Square) for better amplitude detection
        let sum = 0
        for (let i = 0; i < dataArray.length; i++) {
          const normalized = (dataArray[i] - 128) / 128 // Normalize to -1 to 1
          sum += normalized * normalized
        }
        const rms = Math.sqrt(sum / dataArray.length)
        const amplitude = Math.abs(rms) * 100 // Convert to 0-100 scale
        
        // Normalize for visualization (0-1)
        const normalizedLevel = Math.min(amplitude / 50, 1)
        setAudioLevel(normalizedLevel)
        
        // Calibrate background noise level during first few samples
        if (samplesCollected < calibrationSamples) {
          backgroundNoiseLevel = (backgroundNoiseLevel * samplesCollected + amplitude) / (samplesCollected + 1)
          samplesCollected++
        } else {
          // After calibration, use dynamic threshold (background noise + margin)
          // Lower threshold for better sensitivity - use 1.8x instead of 2.5x
          const dynamicThreshold = Math.max(backgroundNoiseLevel * 1.8, 5) // At least 5, or 1.8x background
          
          // Debug logging (can be removed later)
          if (samplesCollected === calibrationSamples + 1) {
            console.log('VAD calibrated:', { backgroundNoiseLevel, dynamicThreshold })
          }
          
          // Detect if speech is present (amplitude significantly above background)
          if (amplitude > dynamicThreshold) {
            hasDetectedSpeech = true
            // Reset silence timer if audio detected
            if (silenceStartTimeRef.current !== null) {
              silenceStartTimeRef.current = null
              setSilenceStartTime(null)
            }
          } else if (hasDetectedSpeech) {
            // Only start silence timer if we've detected speech before
            // This prevents auto-stop before user even speaks
            if (silenceStartTimeRef.current === null) {
              silenceStartTimeRef.current = Date.now()
              setSilenceStartTime(silenceStartTimeRef.current)
            } else {
              const silenceDurationMs = Date.now() - silenceStartTimeRef.current
              if (silenceDurationMs >= silenceDuration) {
                // Auto-stop after silence
                console.log('Auto-stopping recording due to silence', {
                  amplitude,
                  threshold: dynamicThreshold,
                  backgroundNoise: backgroundNoiseLevel,
                  silenceDuration: silenceDurationMs
                })
                stopRecording()
                silenceStartTimeRef.current = null
                setSilenceStartTime(null)
                return // Exit monitoring
              }
            }
          }
        }
        
        // Continue monitoring
        if (voiceOnlyMode && isRecording) {
          animationFrameRef.current = requestAnimationFrame(monitorAudio)
        }
      }
      
      monitorAudio()
    } catch (error) {
      console.error('Error starting audio monitoring:', error)
    }
  }

  const stopAudioMonitoring = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    analyserRef.current = null
    silenceStartTimeRef.current = null
    setAudioLevel(0)
    setSilenceStartTime(null)
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
    if (confirm('Möchtest du den gesamten Chatverlauf wirklich löschen?')) {
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
    
    if (minutes < 1) return 'Gerade eben'
    if (minutes < 60) return `${minutes} Min.`
    
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours} Std.`
    
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
        throw new Error('Antwort konnte nicht geladen werden.')
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
        content: 'Entschuldigung, es ist ein Fehler aufgetreten. Bitte versuch es noch einmal.',
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

  const handleVoiceOnlyMessage = async (transcript: string) => {
    const userMessage: Message = {
      role: 'user',
      content: transcript,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
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
        throw new Error('Antwort konnte nicht geladen werden.')
      }

      const data = await response.json()
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message.content,
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])
      
      // Automatically play the response as audio (don't await - start immediately)
      speakText(assistantMessage.content).catch((error) => {
        console.error('TTS error in voice-only mode:', error)
      })
      
      // Wait for audio to finish, then restart recording
      // This is handled in the audio.onended callback
    } catch (error) {
      console.error('Error sending message:', error)
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Entschuldigung, es ist ein Fehler aufgetreten. Bitte versuch es noch einmal.',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const enterVoiceOnlyMode = async () => {
    setVoiceOnlyMode(true)
    // Start recording immediately
    await startRecording()
  }

  const exitVoiceOnlyMode = () => {
    setVoiceOnlyMode(false)
    stopRecording()
    stopSpeaking()
    stopAudioMonitoring()
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAudioMonitoring()
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

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
      <div className={`${voiceOnlyMode ? 'bg-blue-600' : 'bg-white'} border-b ${voiceOnlyMode ? 'border-blue-700' : 'border-gray-100'} px-3 py-3 sm:px-4 sm:py-3 sticky top-0 z-10 safe-area-inset-top transition-colors`}>
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <div className={`w-10 h-10 sm:w-10 sm:h-10 rounded-lg ${voiceOnlyMode ? 'bg-white' : 'bg-gradient-to-br from-blue-500 to-blue-600'} flex items-center justify-center shadow-sm flex-shrink-0`}>
                <span className={`font-bold text-sm sm:text-base ${voiceOnlyMode ? 'text-blue-600' : 'text-white'}`}>LiS</span>
              </div>
              <div className="min-w-0 flex-1">
                <h1 className={`text-base sm:text-lg font-semibold truncate ${voiceOnlyMode ? 'text-white' : 'text-gray-900'}`}>
                  {voiceOnlyMode ? 'Sprachmodus' : 'LiS Chatbot'}
                </h1>
                <p className={`text-[11px] sm:text-xs truncate ${voiceOnlyMode ? 'text-blue-100' : 'text-gray-500'}`}>
                  {voiceOnlyMode ? 'Sprich weiter, um das Gespräch fortzusetzen' : 'Stelle deine Fragen per Text oder Sprache'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {voiceOnlyMode && (
                <button
                  onClick={exitVoiceOnlyMode}
                  className="p-2.5 sm:p-2 rounded-lg text-white active:bg-blue-700 transition-colors touch-manipulation flex-shrink-0"
                  title="Sprachmodus verlassen"
                  aria-label="Sprachmodus verlassen"
                >
                  <X className="h-5 w-5 sm:h-5 sm:w-5" />
                </button>
              )}
              {!voiceOnlyMode && messages.length > 0 && (
                <button
                  onClick={clearChat}
                  className="p-2.5 sm:p-2 rounded-lg text-gray-500 active:text-red-600 active:bg-red-50 transition-colors touch-manipulation flex-shrink-0"
                  title="Chatverlauf löschen"
                  aria-label="Chatverlauf löschen"
                >
                  <Trash2 className="h-5 w-5 sm:h-5 sm:w-5" />
                </button>
              )}
            </div>
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
                Starte ein Gespräch
              </h2>
              <p className="text-sm sm:text-base text-gray-600 max-w-sm leading-relaxed">
                Schreibe eine Nachricht oder nutze das Mikrofon. Ich helfe dir gerne bei Abfragen deiner Supabase-Datenbank.
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
                    title="Nachricht kopieren"
                    aria-label="Nachricht kopieren"
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
                  <span className="text-sm sm:text-sm text-gray-600">Denke nach...</span>
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input Area - Mobile optimized with larger touch targets */}
      {voiceOnlyMode ? (
        <div className="bg-blue-600 border-t border-blue-700 px-3 py-6 sm:px-4 sm:py-6 safe-area-inset-bottom">
          <div className="max-w-3xl mx-auto">
            <div className="flex flex-col items-center gap-4">
              {isRecording ? (
                <>
                  {/* Audio Level Visualization */}
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full bg-red-500 flex items-center justify-center shadow-lg overflow-hidden">
                    <div 
                      className="absolute inset-0 bg-red-600 transition-all duration-100"
                      style={{ 
                        transform: `scale(${0.7 + audioLevel * 0.3})`,
                        opacity: 0.8 + audioLevel * 0.2
                      }}
                    />
                    <MicOff className="h-10 w-10 sm:h-12 sm:w-12 text-white relative z-10" />
                    {/* Audio level bars */}
                    <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex gap-0.5">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <div
                          key={i}
                          className={`w-1 h-2 sm:h-3 rounded-full transition-all duration-100 ${
                            audioLevel > i * 0.2 ? 'bg-white' : 'bg-white/30'
                          }`}
                          style={{
                            height: `${2 + audioLevel * 8}px`,
                          }}
                        />
                      ))}
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="text-white text-lg sm:text-xl font-semibold mb-1">
                      Ich höre zu ...
                    </p>
                    <p className="text-blue-100 text-sm sm:text-base">
                      {audioLevel > 0.1 ? 'Sprich jetzt' : 'Warte auf deine Stimme ...'}
                    </p>
                    {silenceStartTime && (
                      <p className="text-blue-200 text-xs mt-1">
                        Automatischer Stopp in {Math.max(0, Math.ceil((2000 - (Date.now() - silenceStartTime)) / 1000))}s
                      </p>
                    )}
                  </div>
                  <button
                    onClick={stopRecording}
                    className="px-6 py-3 bg-white text-red-600 rounded-xl font-semibold touch-manipulation active:scale-95 shadow-lg"
                  >
                    Aufnahme stoppen
                  </button>
                </>
              ) : isProcessingVoice || isLoading ? (
                <>
                  <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-blue-500 flex items-center justify-center">
                    <Loader2 className="h-10 w-10 sm:h-12 sm:w-12 text-white animate-spin" />
                  </div>
                  <div className="text-center">
                    <p className="text-white text-lg sm:text-xl font-semibold mb-1">
                      {isProcessingVoice ? 'Verarbeite...' : 'Denke nach...'}
                    </p>
                    <p className="text-blue-100 text-sm sm:text-base">
                      {isProcessingVoice ? 'Transkribiere deine Stimme' : 'Antwort wird erstellt'}
                    </p>
                  </div>
                </>
              ) : isPlayingAudio ? (
                <>
                  <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-green-500 flex items-center justify-center animate-pulse shadow-lg">
                    <Volume2 className="h-10 w-10 sm:h-12 sm:w-12 text-white" />
                  </div>
                  <div className="text-center">
                    <p className="text-white text-lg sm:text-xl font-semibold mb-1">
                      Assistent spricht ...
                    </p>
                    <p className="text-blue-100 text-sm sm:text-base mb-3">
                      Höre dir die Antwort an
                    </p>
                    <button
                      onClick={stopSpeaking}
                      className="px-6 py-3 bg-white text-green-600 rounded-xl font-semibold touch-manipulation active:scale-95 shadow-lg"
                    >
                      Unterbrechen & sprechen
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-white flex items-center justify-center shadow-lg">
                    <Mic className="h-10 w-10 sm:h-12 sm:w-12 text-blue-600" />
                  </div>
                  <div className="text-center">
                    <p className="text-white text-lg sm:text-xl font-semibold mb-1">
                      Bereit zuzuhören
                    </p>
                    <p className="text-blue-100 text-sm sm:text-base">
                      Tippe, um zu sprechen
                    </p>
                  </div>
                  <button
                    onClick={startRecording}
                    className="px-6 py-3 bg-white text-blue-600 rounded-xl font-semibold touch-manipulation active:scale-95 shadow-lg"
                  >
                    Jetzt sprechen
                  </button>
                </>
              )}
              <button
                onClick={exitVoiceOnlyMode}
                className="text-white/80 text-sm mt-2 underline-offset-4 hover:underline focus:underline"
                type="button"
              >
                Zum Textmodus wechseln
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white border-t border-gray-100 px-3 py-3 sm:px-4 sm:py-3 safe-area-inset-bottom">
          <div className="max-w-3xl mx-auto">
            <div className="flex items-end gap-2.5 sm:gap-2">
              <div className="flex-1 relative">
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Nachricht eingeben..."
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
                  onClick={isRecording ? stopRecording : enterVoiceOnlyMode}
                  disabled={isLoading}
                  className={`p-3 sm:p-2.5 rounded-xl sm:rounded-lg transition-all duration-150 touch-manipulation active:scale-95 ${
                    isRecording
                      ? 'bg-red-500 text-white animate-pulse'
                      : 'bg-gray-100 text-gray-700 active:bg-gray-200'
                  } disabled:opacity-50 disabled:cursor-not-allowed min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center`}
                  title={isRecording ? 'Aufnahme stoppen' : 'Sprachmodus starten'}
                  aria-label={isRecording ? 'Aufnahme stoppen' : 'Sprachmodus starten'}
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
                    title={isPlayingAudio ? 'Audio stoppen' : 'Letzte Antwort anhören'}
                    aria-label={isPlayingAudio ? 'Audio stoppen' : 'Letzte Antwort anhören'}
                  >
                    <Volume2 className="h-5 w-5 sm:h-5 sm:w-5" />
                  </button>
                )}

                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || isLoading}
                  className="p-3 sm:p-2.5 bg-blue-600 active:bg-blue-700 text-white rounded-xl sm:rounded-lg transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation active:scale-95 shadow-sm active:shadow min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center"
                  title="Nachricht senden"
                  aria-label="Nachricht senden"
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
      )}
    </div>
  )
}


