/**
 * Patient context formatter with priority truncation.
 *
 * Formats patient data as plain text for use in encounterContext.unstructuredContext.
 * Priority order (highest first): demographics → allergies → medications → conditions.
 * Demographics are ALWAYS included. Total output is truncated to 10KB maximum.
 *
 * Also handles partial FHIR failure scenarios: when some resource types succeed
 * and others fail, the formatter includes all successful data and produces a
 * warning listing exactly the failed resource types.
 *
 * @see Requirements 3.2, 3.5
 */

import type {
  PatientContext,
  FHIRAllergyIntolerance,
  FHIRMedicationRequest,
  FHIRCondition,
} from '../types';

import type { PatientDataResult } from './fhir-client';

/** Maximum size of formatted patient context in bytes. */
const MAX_CONTEXT_BYTES = 10 * 1024; // 10KB

/**
 * Formats a single allergy entry as plain text.
 */
function formatAllergy(allergy: FHIRAllergyIntolerance): string {
  const parts = [`- ${allergy.code.text}`];
  if (allergy.clinicalStatus) {
    parts.push(`(${allergy.clinicalStatus})`);
  }
  if (allergy.criticality) {
    parts.push(`[${allergy.criticality}]`);
  }
  return parts.join(' ');
}

/**
 * Formats a single medication entry as plain text.
 */
function formatMedication(medication: FHIRMedicationRequest): string {
  const parts = [`- ${medication.medicationCodeableConcept.text}`];
  if (medication.status) {
    parts.push(`(${medication.status})`);
  }
  if (medication.dosageInstruction && medication.dosageInstruction.length > 0) {
    const firstDosage = medication.dosageInstruction[0];
    if (firstDosage) {
      parts.push(`— ${firstDosage.text}`);
    }
  }
  return parts.join(' ');
}

/**
 * Formats a single condition entry as plain text.
 */
function formatCondition(condition: FHIRCondition): string {
  const parts = [`- ${condition.code.text}`];
  if (condition.clinicalStatus) {
    parts.push(`(${condition.clinicalStatus})`);
  }
  if (condition.onsetDateTime) {
    parts.push(`onset: ${condition.onsetDateTime}`);
  }
  return parts.join(' ');
}

/**
 * Formats the demographics section as plain text.
 * Demographics are always included regardless of size constraints.
 */
function formatDemographics(demographics: PatientContext['demographics']): string {
  return [
    '=== Patient Demographics ===',
    `Name: ${demographics.name}`,
    `Age: ${demographics.age}`,
    `Sex: ${demographics.sex}`,
    `Date of Birth: ${demographics.dateOfBirth}`,
  ].join('\n');
}

/**
 * Formats a category of items with a header, returning individual formatted lines.
 * Used for allergies, medications, and conditions.
 */
function formatCategoryItems(
  header: string,
  items: string[]
): { header: string; items: string[] } {
  return { header: `\n\n=== ${header} ===`, items };
}

/**
 * Gets the byte length of a string (UTF-8).
 */
function byteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

/**
 * Formats patient data as plain text with priority truncation.
 *
 * Priority order (highest first): demographics → allergies → medications → conditions.
 * If the total formatted text exceeds 10KB, lower-priority categories are removed.
 * If a single category would push the total over 10KB, as many items from that
 * category as fit are included.
 *
 * Demographics are ALWAYS included.
 *
 * @param context - The patient context containing demographics and clinical data
 * @returns Formatted plain text string, at most 10KB
 */
export function formatPatientContext(context: PatientContext): string {
  const demographicsText = formatDemographics(context.demographics);
  let result = demographicsText;
  let currentBytes = byteLength(result);

  // Define categories in priority order (after demographics)
  const categories: { header: string; items: string[] }[] = [
    formatCategoryItems(
      'Allergies',
      context.allergies.map(formatAllergy)
    ),
    formatCategoryItems(
      'Medications',
      context.medications.map(formatMedication)
    ),
    formatCategoryItems(
      'Conditions',
      context.conditions.map(formatCondition)
    ),
  ];

  for (const category of categories) {
    // Skip empty categories
    if (category.items.length === 0) {
      continue;
    }

    // Check if we can fit the header
    const headerWithNewlines = category.header;
    const headerBytes = byteLength(headerWithNewlines);

    if (currentBytes + headerBytes > MAX_CONTEXT_BYTES) {
      // Can't even fit the header, stop here
      break;
    }

    // Try to add items one by one
    let categoryText = headerWithNewlines;
    let categoryBytes = headerBytes;
    let itemsAdded = 0;

    for (const item of category.items) {
      const itemLine = '\n' + item;
      const itemBytes = byteLength(itemLine);

      if (currentBytes + categoryBytes + itemBytes > MAX_CONTEXT_BYTES) {
        // Can't fit this item, stop adding items from this category
        break;
      }

      categoryText += itemLine;
      categoryBytes += itemBytes;
      itemsAdded++;
    }

    if (itemsAdded > 0) {
      result += categoryText;
      currentBytes += categoryBytes;
    } else {
      // Per spec: "include as many items from that category as fit"
      // If zero items fit, stop processing further categories
      break;
    }
  }

  return result;
}


// ─── FHIR Resource Type Names ────────────────────────────────────────────────

/** The FHIR resource types that are fetched for patient context. */
export type FHIRResourceType = 'conditions' | 'medications' | 'allergies';

// ─── Partial Failure Handling ────────────────────────────────────────────────

/**
 * Result of processing patient data with partial failure handling.
 * Contains the formatted patient context from successful resource types
 * and a warning listing any resource types that failed.
 *
 * @see Requirements 3.5
 */
export interface PatientContextDisplayResult {
  /** Formatted patient context text (from successful resource types only). */
  formattedContext: string;
  /** Warning message listing failed resource types, or null if all succeeded. */
  warning: string | null;
  /** List of resource types that failed to load. */
  failedResourceTypes: FHIRResourceType[];
  /** List of resource types that loaded successfully. */
  successfulResourceTypes: FHIRResourceType[];
}

/**
 * Processes a PatientDataResult (which may have partial failures) into a
 * display result containing the formatted context from successful resource types
 * and a warning listing exactly the resource types that failed.
 *
 * Per Requirements 3.5: If the FHIR API returns an error for one or more resource
 * types but succeeds for at least one, the application SHALL display the successfully
 * retrieved data and show a warning indicating which resource types could not be loaded.
 *
 * @param dataResult - The result from FHIRClient.getPatientData()
 * @param demographics - Patient demographics (always required)
 * @returns Display result with formatted context and optional warning
 */
export function processPatientDataResult(
  dataResult: PatientDataResult,
  demographics: PatientContext['demographics']
): PatientContextDisplayResult {
  const failedResourceTypes: FHIRResourceType[] = [];
  const successfulResourceTypes: FHIRResourceType[] = [];

  // Determine which resource types succeeded and which failed
  if (dataResult.allergies.success) {
    successfulResourceTypes.push('allergies');
  } else {
    failedResourceTypes.push('allergies');
  }

  if (dataResult.medications.success) {
    successfulResourceTypes.push('medications');
  } else {
    failedResourceTypes.push('medications');
  }

  if (dataResult.conditions.success) {
    successfulResourceTypes.push('conditions');
  } else {
    failedResourceTypes.push('conditions');
  }

  // Build patient context using only successful resource types
  const context: PatientContext = {
    demographics,
    allergies: dataResult.allergies.success ? (dataResult.allergies.data ?? []) : [],
    medications: dataResult.medications.success ? (dataResult.medications.data ?? []) : [],
    conditions: dataResult.conditions.success ? (dataResult.conditions.data ?? []) : [],
  };

  const formattedContext = formatPatientContext(context);

  // Build warning message if any resource types failed
  let warning: string | null = null;
  if (failedResourceTypes.length > 0) {
    warning = `The following resource types could not be loaded: ${failedResourceTypes.join(', ')}`;
  }

  return {
    formattedContext,
    warning,
    failedResourceTypes,
    successfulResourceTypes,
  };
}
