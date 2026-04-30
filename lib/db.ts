import Dexie, { type Table } from 'dexie'

export interface LocalFeeding {
  id?: number
  clientId: string
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
    this.version(2)
      .stores({
        feedings: '++id, startedAt, synced, clientId',
      })
      .upgrade(async (tx) => {
        await tx
          .table<LocalFeeding>('feedings')
          .toCollection()
          .modify((f) => {
            if (!f.clientId) f.clientId = crypto.randomUUID()
          })
      })
  }
}

export const db = new LatchDB()
