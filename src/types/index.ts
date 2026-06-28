export type SourceType = 'audio' | 'screenshot' | 'text_paste' | 'pdf' | 'note'
export type ConflictOutcome = 'resolved' | 'unresolved' | 'escalated' | 'deferred'
export type NavItem = 'dashboard' | 'conversations' | 'collections' | 'insights' | 'patterns' | 'goals' | 'coaching' | 'settings'

export interface Participant {
  id: string
  conversation_id: string
  name: string
  label: string
  color: string
  avatar_initials: string
  confidence?: number
}

export interface Utterance {
  id: string
  conversation_id: string
  speaker_label: string
  speaker_name?: string
  content: string
  start_ms: number
  end_ms: number
  confidence: number
  sequence: number
  topics_detected?: string[]
}

export interface AnalysisRun {
  id: string
  conversation_id: string
  quality_score: number
  escalation_score: number
  validation_score: number
  collaboration_score: number
  topic_drift_score: number
  resolution_probability: number
  interruption_rate_a: number
  interruption_rate_b: number
  outcome: ConflictOutcome
  topics: string[]
  themes: string[]
  key_insights: string[]
  coaching_recommendations: string[]
  suggested_response?: string
  horsemen: {
    criticism: number
    defensiveness: number
    contempt: number
    stonewalling: number
    overall: number
    trend: 'rising' | 'falling' | 'stable'
  }
  repair: {
    validation_attempts: number
    accountability_attempts: number
    successful_repairs: number
    resilience_score: number
  }
  validation_by_speaker: Record<string, number>
  created_at: string
  status: string
}

export interface Conversation {
  id: string
  title: string
  source_type: SourceType
  created_at: string
  duration_sec?: number
  modality?: string
  participants: Participant[]
  utterances: Utterance[]
  analysis?: AnalysisRun
  attachment_key?: string
  audio_key?: string
  raw_text?: string
  status: string
}

export interface Collection {
  id: string
  name: string
  description?: string
  member_count: number
  quality_score_avg?: number
  escalation_trend?: string
  dominant_outcome?: string
  created_at: string
  updated_at: string
}
