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
 * RESPONSIBLE AI: This module formats patient data for AI context. The formatted output
 * is sent to Amazon Connect Health to provide clinical context for ambient documentation.
 * Only clinically relevant data is included. Patient privacy is protected through
 * encryption in transit (TLS) and at rest (KMS). AI-generated outputs derived from
 * this context require clinician review before use in patient care decisions.
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
 * Allowed character regex for Amazon Connect Health encounterContext.unstructuredContext.
 * Pattern: [a-zA-Z0-9\s\*_\-#\[\]\(\)\.,:;!?'"`<>~/]+
 */
const ALLOWED_CHARS_REGEX = /[^a-zA-Z0-9\s*_\-#\[\]()\.,;:!?'"`<>~/]/g;

/**
 * Sanitizes a string to only contain characters allowed by the Connect Health API.
 * Replaces disallowed characters (like =, @, +, &, {, }, |, ^, %) with safe alternatives.
 * Preserves newlines for display formatting.
 */
function sanitizeForConnectHealth(text: string): string {
  return text
    .replace(ALLOWED_CHARS_REGEX, ' ')
    .replace(/[^\S\n]{2,}/g, ' '); // Collapse multiple spaces but preserve newlines
}

/**
 * Formats a single allergy entry as plain text.
 */
function formatAllergy(allergy: FHIRAllergyIntolerance): string {
  // OpenEMR maps allergy title to various FHIR fields depending on version.
  // Check multiple locations in priority order.
  let name = '';

  // 1. code.text (standard FHIR location)
  if (typeof allergy.code === 'object' && allergy.code) {
    const codeText = allergy.code.text || '';
    const codingDisplay = allergy.code.coding?.[0]?.display || '';
    const codingCode = allergy.code.coding?.[0]?.code || '';
    const codingSystem = allergy.code.coding?.[0]?.system || '';

    // Skip data-absent-reason system values (OpenEMR uses this when code is unmapped)
    const isDataAbsentReason = codingSystem.includes('data-absent-reason');

    if (codeText && codeText.toLowerCase() !== 'unknown') {
      name = codeText;
    } else if (!isDataAbsentReason && codingDisplay && codingDisplay.toLowerCase() !== 'unknown') {
      name = codingDisplay;
    } else if (!isDataAbsentReason && codingCode && codingCode.toLowerCase() !== 'unknown') {
      name = codingCode;
    }
  } else if (typeof allergy.code === 'string') {
    name = allergy.code || '';
  }

  // 2. reaction[0].substance (OpenEMR sometimes puts the name here)
  if (!name && (allergy as any).reaction?.[0]?.substance) {
    const substance = (allergy as any).reaction[0].substance;
    name = substance.text || substance.coding?.[0]?.display || '';
  }

  // 3. note[0].text (some OpenEMR versions put title in note)
  if (!name && (allergy as any).note?.[0]?.text) {
    name = (allergy as any).note[0].text;
  }

  // 4. reaction[0].manifestation[0].text or display
  if (!name && (allergy as any).reaction?.[0]?.manifestation?.[0]) {
    const manifestation = (allergy as any).reaction[0].manifestation[0];
    name = manifestation.text || manifestation.coding?.[0]?.display || '';
  }

  // 5. text.div (narrative text — strip HTML)
  if (!name && (allergy as any).text?.div) {
    const div = (allergy as any).text.div as string;
    name = div.replace(/<[^>]*>/g, '').trim();
    // Take first meaningful chunk (before any status info)
    if (name.length > 50) name = name.substring(0, 50);
  }

  // 6. category as last resort (e.g., "food", "medication", "environment")
  if (!name && (allergy as any).category) {
    const cats = (allergy as any).category;
    if (Array.isArray(cats) && cats.length > 0) {
      name = `${cats[0]} allergy`;
    }
  }

  if (!name) name = 'Unknown';

  const parts = [`- ${name}`];
  if (allergy.clinicalStatus) {
    const status = typeof allergy.clinicalStatus === 'object'
      ? ((allergy.clinicalStatus as any)?.coding?.[0]?.code || '')
      : String(allergy.clinicalStatus);
    if (status) parts.push(`(${status})`);
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
  // Handle medicationCodeableConcept as object or nested
  const medName = typeof medication.medicationCodeableConcept === 'object'
    ? (medication.medicationCodeableConcept?.text || medication.medicationCodeableConcept?.coding?.[0]?.display || 'Unknown medication')
    : String(medication.medicationCodeableConcept || 'Unknown medication');
  const parts = [`- ${medName}`];
  if (medication.status) {
    parts.push(`(${medication.status})`);
  }
  if (medication.dosageInstruction && medication.dosageInstruction.length > 0) {
    const firstDosage = medication.dosageInstruction[0];
    if (firstDosage?.text) {
      parts.push(`— ${firstDosage.text}`);
    }
  }
  return parts.join(' ');
}

/**
 * Formats a single condition entry as plain text.
 */
function formatCondition(condition: FHIRCondition): string {
  // Handle code as CodeableConcept
  const condName = typeof condition.code === 'object'
    ? (condition.code?.text || condition.code?.coding?.[0]?.display || 'Unknown condition')
    : String(condition.code || 'Unknown condition');
  const parts = [`- ${condName}`];
  if (condition.clinicalStatus) {
    const status = typeof condition.clinicalStatus === 'object'
      ? ((condition.clinicalStatus as any)?.coding?.[0]?.code || '')
      : String(condition.clinicalStatus);
    if (status) parts.push(`(${status})`);
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
    '--- Patient Demographics ---',
    `Name: ${sanitizeForConnectHealth(demographics.name)}`,
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
  return { header: `\n\n--- ${header} ---`, items };
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

  // Add encounters if available
  if ((context as any).encounters && Array.isArray((context as any).encounters)) {
    const encounters = (context as any).encounters as any[];
    if (encounters.length > 0) {
      const encounterItems = encounters.map((enc: any) => {
        const date = enc.period?.start || enc.date || 'Unknown date';
        const dateStr = date.substring(0, 10);
        const reason = enc.reasonCode?.[0]?.text
          || enc.reasonCode?.[0]?.coding?.[0]?.display
          || enc.type?.[0]?.text
          || enc.type?.[0]?.coding?.[0]?.display
          || enc.class?.display
          || enc.serviceType?.text
          || 'Visit';
        const status = enc.status || '';

        // Build encounter line with reason and optional summary
        let line = `- ${dateStr} ${reason}${status ? ` (${status})` : ''}`;

        // Include encounter note/summary if available (from DocumentReference or contained)
        if (enc._summary) {
          line += `\n  Summary: ${enc._summary}`;
        }

        return line;
      });
      categories.push(
        formatCategoryItems('Recent Encounters', encounterItems)
      );

      // Add follow-up suggestions based on conditions and encounters
      const followUpItems: string[] = [];
      if (context.conditions.length > 0) {
        followUpItems.push(`- Review status of ${context.conditions[0]?.code?.text || (context.conditions[0]?.code as any)?.coding?.[0]?.display || 'primary condition'}`);
      }
      if (context.medications.length > 0) {
        followUpItems.push('- Confirm medication adherence and side effects');
      }
      if (encounters.length >= 2) {
        followUpItems.push('- Compare symptoms since last visit');
      }
      followUpItems.push('- Discuss any new symptoms or concerns');
      followUpItems.push('- Review preventive care schedule');

      if (followUpItems.length > 0) {
        categories.push(
          formatCategoryItems('Suggested Follow-up Questions', followUpItems)
        );
      }
    }
  }

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

  // Sanitize the final output to only contain characters allowed by Connect Health API
  return sanitizeForConnectHealth(result);
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
  const context: PatientContext & { encounters?: any[] } = {
    demographics,
    allergies: dataResult.allergies.success ? (dataResult.allergies.data ?? []) : [],
    medications: dataResult.medications.success ? (dataResult.medications.data ?? []) : [],
    conditions: dataResult.conditions.success ? (dataResult.conditions.data ?? []) : [],
    encounters: (dataResult as any).encounters?.success ? ((dataResult as any).encounters.data ?? []) : [],
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
