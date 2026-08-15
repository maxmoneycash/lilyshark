/**
 * Shelby API Types
 * These types are used for type-checking throughout the frontend
 */

export interface Blob {
  owner: string
  name: string
  encoding: string
  expires: string
  size: string
  id: string
}

export interface NetworkStats {
  totalBlobs: number
  totalStorage: string
  uploadRate: number
  recentBlobs: Blob[]
  timestamp: number
}
