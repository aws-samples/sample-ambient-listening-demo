'use client';

import { useState, useEffect, useCallback } from 'react';

export interface Patient {
  id: string;
  name: string;
  dateOfBirth: string | null;
}

export interface PatientSelectorProps {
  onSelect: (patient: Patient) => void;
  selectedPatientId?: string;
}

/**
 * PatientSelector — Search and select patients from OpenEMR via /api/patients.
 * Displays a searchable list of patients with name, DOB, and ID.
 *
 * @see Requirements 3.1
 */
export function PatientSelector({ onSelect, selectedPatientId }: PatientSelectorProps) {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPatients = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/patients');

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body?.message ?? `Failed to load patients (HTTP ${response.status})`;
        setError(message);
        setPatients([]);
        return;
      }

      const data: Patient[] = await response.json();
      setPatients(data);
    } catch (err) {
      setError('Unable to connect to the patient service. Please try again.');
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPatients();
  }, [fetchPatients]);

  const filteredPatients = patients.filter((patient) => {
    if (!searchTerm.trim()) return true;
    const term = searchTerm.toLowerCase();
    return (
      patient.name.toLowerCase().includes(term) ||
      patient.id.toLowerCase().includes(term) ||
      (patient.dateOfBirth?.includes(term) ?? false)
    );
  });

  if (loading) {
    return (
      <div className="p-4" role="status" aria-label="Loading patients">
        <div className="animate-pulse space-y-3">
          <div className="h-10 bg-gray-200 rounded" />
          <div className="h-8 bg-gray-200 rounded w-3/4" />
          <div className="h-8 bg-gray-200 rounded w-1/2" />
          <div className="h-8 bg-gray-200 rounded w-2/3" />
        </div>
        <p className="mt-2 text-sm text-gray-500">Loading patients…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 border border-red-200 bg-red-50 rounded-lg" role="alert">
        <p className="text-sm font-medium text-red-800">Error loading patients</p>
        <p className="mt-1 text-sm text-red-600">{error}</p>
        <button
          onClick={fetchPatients}
          className="mt-3 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-100 rounded hover:bg-red-200 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <label htmlFor="patient-search" className="sr-only">
        Search patients
      </label>
      <input
        id="patient-search"
        type="text"
        placeholder="Search by name, ID, or date of birth…"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        aria-label="Search patients"
      />

      <ul className="divide-y divide-gray-100 max-h-80 overflow-y-auto rounded-lg border border-gray-200" role="listbox" aria-label="Patient list">
        {filteredPatients.length === 0 ? (
          <li className="px-4 py-3 text-sm text-gray-500 text-center">
            No patients found.
          </li>
        ) : (
          filteredPatients.map((patient) => {
            const isSelected = patient.id === selectedPatientId;
            return (
              <li
                key={patient.id}
                role="option"
                aria-selected={isSelected}
                className={`px-4 py-3 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-blue-50 border-l-4 border-l-blue-500'
                    : 'hover:bg-gray-50'
                }`}
                onClick={() => onSelect(patient)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(patient);
                  }
                }}
                tabIndex={0}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{patient.name}</p>
                    <p className="text-xs text-gray-500">
                      DOB: {patient.dateOfBirth ?? 'Unknown'} · ID: {patient.id}
                    </p>
                  </div>
                  {isSelected && (
                    <span className="text-blue-600 text-xs font-medium">Selected</span>
                  )}
                </div>
              </li>
            );
          })
        )}
      </ul>

      {filteredPatients.length > 0 && (
        <p className="text-xs text-gray-400">
          {filteredPatients.length} patient{filteredPatients.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  );
}
