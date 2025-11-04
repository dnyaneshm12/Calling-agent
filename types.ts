
export enum CallState {
  IDLE = 'IDLE',
  CONNECTING = 'CONNECTING',
  ACTIVE = 'ACTIVE',
  ENDED = 'ENDED',
  ERROR = 'ERROR',
}

export interface TranscriptEntry {
  author: 'user' | 'agent';
  text: string;
}
