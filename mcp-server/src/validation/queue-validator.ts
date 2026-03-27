// Copyright (C) 2025 Keygraph, Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License version 3
// as published by the Free Software Foundation.

/**
 * Queue Validator
 *
 * Validates JSON structure for deliverable queue files.
 */

import type { DeliverableQueue } from '../types/deliverables.js';

export interface ValidationResult {
  valid: boolean;
  message?: string;
  data?: DeliverableQueue;
}

/**
 * Validate JSON structure for deliverable queue files
 * Queue files must be valid JSON objects
 */
export function validateQueueJson(content: string): ValidationResult {
  try {
    const parsed = JSON.parse(content) as unknown;

    // Type guard for the parsed result
    if (typeof parsed !== 'object' || parsed === null) {
      return {
        valid: false,
        message: `Invalid JSON structure: Expected an object. Got: ${typeof parsed}`,
      };
    }

    return {
      valid: true,
      data: parsed as DeliverableQueue,
    };
  } catch (error) {
    return {
      valid: false,
      message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
