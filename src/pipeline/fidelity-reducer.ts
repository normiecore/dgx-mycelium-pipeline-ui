import type { DepartmentEngram, OrgEngram } from '../types.js';
import type { EngramWithPriority } from './engram-builder.js';

export class FidelityReducer {
  /**
   * Reduce a full engram to department-level fidelity.
   * Strips: raw_text, confidence, sensitivity_classification,
   *         notification_priority, approval_status, approved_at, approved_by,
   *         captured_at, source_type
   */
  toDepartment(engram: EngramWithPriority): DepartmentEngram {
    return {
      concept: engram.concept,
      content: engram.content,
      source_app: engram.source_app,
      user_id: engram.user_id,
      user_email: engram.user_email,
      tags: [...engram.tags],
    };
  }

  /**
   * Reduce a full engram to org-level fidelity.
   * Strips individual attribution; adds department.
   */
  toOrg(engram: EngramWithPriority, department: string): OrgEngram {
    return {
      concept: engram.concept,
      tags: [...engram.tags],
      department,
    };
  }
}
