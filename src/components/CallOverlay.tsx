import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { displayName } from '../lib/displayName'
import { triggerNudgeShake } from '../lib/nudge'
import { ICE_SERVERS, type CallKind, type CallPeer, type CallSignal, type OutgoingCallRequest } from '../lib/call'
import { IconMic, IconMicOff, IconPhone, IconPhoneOff, IconUser, IconVideo, IconVideoOff } from './icons'
import type { Profile } from '../types'

type Direction = 'incoming' | 'outgoing'
type Status = 'ringing' | 'connecting' | 'connected'

type Session = {
  callId: string
  peer: CallPeer
  conversationId: string
  kind: CallKind
  direction: Direction
  status: Status
  startedAt: number | null
}

type Props = {
  me: Profile | null
}

export type CallOverlayHandle = {
  startCall: (req: OutgoingCallRequest) => void
}

const RING_TIMEOUT_MS = 30000

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export const CallOverlay = forwardRef<CallOverlayHandle, Props>(function CallOverlay({ me }, ref) {
  const [session, setSession] = useState<Session | null>(null)
  const [muted, setMuted] = useState(false)
  const [cameraOff, setCameraOff] = useState(false)
  const [tick, setTick] = useState(0)

  const sessionRef = useRef<Session | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peerChannelRef = useRef<RealtimeChannel | null>(null)
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([])
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null)
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    if (session?.status !== 'connected') return
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [session?.status])

  function clearRingTimeout() {
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current)
      ringTimeoutRef.current = null
    }
  }

  function sendOneOff(peerId: string, signal: CallSignal) {
    const ch = supabase.channel(`call:${peerId}`)
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        ch.send({ type: 'broadcast', event: 'call', payload: signal })
        setTimeout(() => supabase.removeChannel(ch), 1000)
      }
    })
  }

  function openPeerChannel(peerId: string): Promise<RealtimeChannel> {
    return new Promise((resolve) => {
      const ch = supabase.channel(`call:${peerId}`)
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          peerChannelRef.current = ch
          resolve(ch)
        }
      })
    })
  }

  function sendSignal(signal: CallSignal) {
    peerChannelRef.current?.send({ type: 'broadcast', event: 'call', payload: signal })
  }

  function cleanupCall() {
    clearRingTimeout()
    pcRef.current?.close()
    pcRef.current = null
    localStreamRef.current?.getTracks().forEach((t) => t.stop())
    localStreamRef.current = null
    if (peerChannelRef.current) {
      supabase.removeChannel(peerChannelRef.current)
      peerChannelRef.current = null
    }
    pendingCandidatesRef.current = []
    pendingOfferRef.current = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
    setMuted(false)
    setCameraOff(false)
    setSession(null)
  }

  function setupPeerConnection(peerId: string, callId: string, kind: CallKind, stream: MediaStream) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
    pcRef.current = pc
    stream.getTracks().forEach((t) => pc.addTrack(t, stream))

    pc.onicecandidate = (e) => {
      if (!e.candidate) return
      const signal: CallSignal = { type: 'call-ice', callId, from: me!.id, candidate: e.candidate.toJSON() }
      if (peerChannelRef.current) sendSignal(signal)
      else sendOneOff(peerId, signal)
    }

    pc.ontrack = (e) => {
      const remoteStream = e.streams[0]
      if (kind === 'video' && remoteVideoRef.current) remoteVideoRef.current.srcObject = remoteStream
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remoteStream
    }

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        clearRingTimeout()
        setSession((s) => (s ? { ...s, status: 'connected', startedAt: s.startedAt ?? Date.now() } : s))
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected' || pc.connectionState === 'closed') {
        if (sessionRef.current?.callId === callId) cleanupCall()
      }
    }

    return pc
  }

  async function startOutgoingCall(req: OutgoingCallRequest) {
    if (!me || sessionRef.current) return
    const callId = crypto.randomUUID()
    setSession({
      callId,
      peer: req.peer,
      conversationId: req.conversationId,
      kind: req.kind,
      direction: 'outgoing',
      status: 'ringing',
      startedAt: null,
    })

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: req.kind === 'video' })
    } catch (err) {
      console.error('getUserMedia failed', err)
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      alert(`Não consegui acessar o microfone/câmera.\n(${reason})`)
      setSession(null)
      return
    }
    localStreamRef.current = stream
    if (req.kind === 'video' && localVideoRef.current) localVideoRef.current.srcObject = stream

    const pc = setupPeerConnection(req.peer.id, callId, req.kind, stream)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)

    const ch = await openPeerChannel(req.peer.id)
    ch.send({
      type: 'broadcast',
      event: 'call',
      payload: {
        type: 'call-offer',
        callId,
        from: me.id,
        fromName: displayName(me),
        fromAvatar: me.avatar_url ?? null,
        conversationId: req.conversationId,
        kind: req.kind,
        sdp: offer,
      } as CallSignal,
    })

    ringTimeoutRef.current = setTimeout(() => {
      if (sessionRef.current?.callId === callId && sessionRef.current.status === 'ringing') {
        sendSignal({ type: 'call-end', callId, from: me.id })
        cleanupCall()
      }
    }, RING_TIMEOUT_MS)
  }

  async function acceptIncomingCall() {
    const s = sessionRef.current
    if (!me || !s || s.direction !== 'incoming' || !pendingOfferRef.current) return
    clearRingTimeout()

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: s.kind === 'video' })
    } catch (err) {
      console.error('getUserMedia failed', err)
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      alert(`Não consegui acessar o microfone/câmera.\n(${reason})`)
      sendOneOff(s.peer.id, { type: 'call-decline', callId: s.callId, from: me.id })
      cleanupCall()
      return
    }
    localStreamRef.current = stream
    if (s.kind === 'video' && localVideoRef.current) localVideoRef.current.srcObject = stream

    const pc = setupPeerConnection(s.peer.id, s.callId, s.kind, stream)
    await pc.setRemoteDescription(new RTCSessionDescription(pendingOfferRef.current))
    for (const c of pendingCandidatesRef.current) {
      await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
    }
    pendingCandidatesRef.current = []

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    const ch = await openPeerChannel(s.peer.id)
    ch.send({
      type: 'broadcast',
      event: 'call',
      payload: { type: 'call-answer', callId: s.callId, from: me.id, sdp: answer } as CallSignal,
    })

    setSession((prev) => (prev ? { ...prev, status: 'connecting' } : prev))
  }

  function declineIncomingCall() {
    const s = sessionRef.current
    if (!me || !s) return
    sendOneOff(s.peer.id, { type: 'call-decline', callId: s.callId, from: me.id })
    cleanupCall()
  }

  function endCall() {
    const s = sessionRef.current
    if (!me || !s) return
    const signal: CallSignal = { type: 'call-end', callId: s.callId, from: me.id }
    if (peerChannelRef.current) sendSignal(signal)
    else sendOneOff(s.peer.id, signal)
    cleanupCall()
  }

  function toggleMute() {
    const track = localStreamRef.current?.getAudioTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setMuted(!track.enabled)
  }

  function toggleCamera() {
    const track = localStreamRef.current?.getVideoTracks()[0]
    if (!track) return
    track.enabled = !track.enabled
    setCameraOff(!track.enabled)
  }

  useImperativeHandle(ref, () => ({
    startCall: (req: OutgoingCallRequest) => {
      if (sessionRef.current) return
      startOutgoingCall(req)
    },
  }))

  useEffect(() => {
    if (!me) return
    const channel = supabase
      .channel(`call:${me.id}`)
      .on('broadcast', { event: 'call' }, ({ payload }) => {
        const signal = payload as CallSignal
        const current = sessionRef.current

        if (signal.type === 'call-offer') {
          if (current) {
            sendOneOff(signal.from, { type: 'call-decline', callId: signal.callId, from: me.id })
            return
          }
          pendingOfferRef.current = signal.sdp
          triggerNudgeShake()
          setSession({
            callId: signal.callId,
            peer: { id: signal.from, name: signal.fromName, avatarUrl: signal.fromAvatar },
            conversationId: signal.conversationId,
            kind: signal.kind,
            direction: 'incoming',
            status: 'ringing',
            startedAt: null,
          })
          ringTimeoutRef.current = setTimeout(() => {
            if (sessionRef.current?.callId === signal.callId && sessionRef.current.status === 'ringing') {
              cleanupCall()
            }
          }, RING_TIMEOUT_MS)
          return
        }

        if (!current || current.callId !== signal.callId) return

        if (signal.type === 'call-answer') {
          pcRef.current?.setRemoteDescription(new RTCSessionDescription(signal.sdp)).then(() => {
            const queued = pendingCandidatesRef.current
            pendingCandidatesRef.current = []
            queued.forEach((c) => pcRef.current?.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}))
          })
          setSession((s) => (s ? { ...s, status: 'connecting' } : s))
        } else if (signal.type === 'call-ice') {
          if (pcRef.current?.remoteDescription) {
            pcRef.current.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {})
          } else {
            pendingCandidatesRef.current.push(signal.candidate)
          }
        } else if (signal.type === 'call-end' || signal.type === 'call-decline') {
          cleanupCall()
        }
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.id])

  if (!session) return null

  const duration = session.startedAt ? formatDuration(Date.now() - session.startedAt) : null
  void tick // force re-render each second while connected

  return (
    <div className="call-overlay">
      {session.kind === 'video' && session.status === 'connected' && (
        <video ref={remoteVideoRef} className="call-remote-video" autoPlay playsInline />
      )}
      <audio ref={remoteAudioRef} autoPlay />

      {(session.kind === 'audio' || session.status !== 'connected') && (
        <div className="call-peer-info">
          <div className="call-peer-avatar">
            {session.peer.avatarUrl ? <img src={session.peer.avatarUrl} alt="" /> : <IconUser size={40} />}
          </div>
          <div className="call-peer-name">{session.peer.name}</div>
          <div className="call-peer-status">
            {session.status === 'ringing' && session.direction === 'incoming' && `chamada de ${session.kind === 'video' ? 'vídeo' : 'voz'} recebida`}
            {session.status === 'ringing' && session.direction === 'outgoing' && 'chamando...'}
            {session.status === 'connecting' && 'conectando...'}
            {session.status === 'connected' && duration}
          </div>
        </div>
      )}

      {session.kind === 'video' && session.status === 'connected' && (
        <video ref={localVideoRef} className="call-local-video" autoPlay playsInline muted />
      )}

      <div className="call-controls">
        {session.direction === 'incoming' && session.status === 'ringing' ? (
          <>
            <button type="button" className="call-btn call-btn-decline" onClick={declineIncomingCall}>
              <IconPhoneOff size={24} />
            </button>
            <button type="button" className="call-btn call-btn-accept" onClick={acceptIncomingCall}>
              <IconPhone size={24} />
            </button>
          </>
        ) : (
          <>
            <button type="button" className={`call-btn call-btn-secondary${muted ? ' active' : ''}`} onClick={toggleMute}>
              {muted ? <IconMicOff size={22} /> : <IconMic size={22} />}
            </button>
            {session.kind === 'video' && (
              <button type="button" className={`call-btn call-btn-secondary${cameraOff ? ' active' : ''}`} onClick={toggleCamera}>
                {cameraOff ? <IconVideoOff size={22} /> : <IconVideo size={22} />}
              </button>
            )}
            <button type="button" className="call-btn call-btn-decline" onClick={endCall}>
              <IconPhoneOff size={24} />
            </button>
          </>
        )}
      </div>
    </div>
  )
})
