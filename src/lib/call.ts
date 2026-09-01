export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
]

export type CallKind = 'audio' | 'video'

export type CallPeer = {
  id: string
  name: string
  avatarUrl: string | null
}

export type OutgoingCallRequest = {
  peer: CallPeer
  kind: CallKind
  conversationId: string
}

export type PendingCallRow = {
  id: string
  caller_id: string
  callee_id: string
  conversation_id: string
  kind: CallKind
  status: 'ringing' | 'answered' | 'declined' | 'ended'
  offer_sdp: RTCSessionDescriptionInit
  caller_name: string
  caller_avatar: string | null
  created_at: string
}

export type CallSignal =
  | {
      type: 'call-offer'
      callId: string
      from: string
      fromName: string
      fromAvatar: string | null
      conversationId: string
      kind: CallKind
      sdp: RTCSessionDescriptionInit
    }
  | { type: 'call-answer'; callId: string; from: string; sdp: RTCSessionDescriptionInit }
  | { type: 'call-ice'; callId: string; from: string; candidate: RTCIceCandidateInit }
  | { type: 'call-end'; callId: string; from: string }
  | { type: 'call-decline'; callId: string; from: string }
