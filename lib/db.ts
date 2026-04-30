import Dexie, { type Table } from 'dexie'

export interface LocalFeeding {
  id?: number
  serverId?: string | null
  startedAt: Date
  endedAt: Date
  side: 'left' | 'right'
  mood: string | null
  note: string
  synced: boolean
}

class LatchDB extends Dexie {
  feedings!: Table<LocalFeeding, number>

  constructor() {
    super('latch')
    this.version(1).stores({
      feedings: '++id, startedAt, synced',
    })
  }
}

export const db = new LatchDB()
