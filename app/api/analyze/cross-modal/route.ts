import { NextRequest, NextResponse } from 'next/server'
import { processAndAnalyzeMedia } from '@/lib/backend-engine/analyzer-service'
import type { ForensicAnalysisOutput } from '@/lib/backend-engine/types'
import { investigationStore } from '@/lib/backend-engine/investigation-store'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const files = formData.getAll('files') as File[]
    const singleFile = formData.get('file') as File | null
    const allFiles = files.length > 0 ? files : singleFile ? [singleFile] : []
    const context = (formData.get('context') as string) || ''

    if (allFiles.length === 0) {
      return NextResponse.json(
        { detail: 'No evidence files provided for cross-modal analysis.' },
        { status: 400 }
      )
    }

    // Process primary file
    const primaryFile = allFiles[0]
    const primaryResult = await processAndAnalyzeMedia(primaryFile, primaryFile.name, context)

    // If multiple files (e.g. video + separate audio/transcript file), correlate them
    if (allFiles.length > 1) {
      for (let i = 1; i < allFiles.length; i++) {
        const secondary = allFiles[i]
        primaryResult.evidenceRelationships.push({
          source: primaryFile.name,
          target: secondary.name,
          relationship: 'Cross-Modal Bundle Association',
          explanation: `Associated ${primaryFile.name} with secondary context stream ${secondary.name} (${secondary.type || 'document'}).`,
          inconsistencyType: 'general',
        })
      }
      investigationStore.saveOutput(primaryResult)
    }

    return NextResponse.json(primaryResult, { status: 200 })
  } catch (err) {
    return NextResponse.json(
      { detail: `Cross-modal analysis error: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
