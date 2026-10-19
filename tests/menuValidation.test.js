import { describe, it, expect } from 'vitest';
import {
  validateWorkshopInput,
  validateRegistrationInput,
  validateCancellationConfirmation,
  validateFailureSimulationChoice,
} from '../src/utils/menuValidation.js';

describe('6. CLI Menu Input Validation Helpers', () => {
  describe('validateWorkshopInput', () => {
    it('accepts valid workshop payload', () => {
      const result = validateWorkshopInput({
        title: 'Distributed Systems',
        description: 'Advanced patterns',
        organizerId: 'org_1',
      });
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.data).toEqual({
        title: 'Distributed Systems',
        description: 'Advanced patterns',
        organizerId: 'org_1',
      });
    });

    it('rejects empty or whitespace-only fields', () => {
      const result = validateWorkshopInput({
        title: '   ',
        description: '',
        organizerId: null,
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });

    it('rejects title longer than 200 characters', () => {
      const longTitle = 'a'.repeat(201);
      const result = validateWorkshopInput({
        title: longTitle,
        description: 'Valid description',
        organizerId: 'org_1',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toMatch(/200 characters/i);
    });
  });

  describe('validateRegistrationInput', () => {
    it('accepts valid registration payload', () => {
      const result = validateRegistrationInput({
        workshopId: 'ws-123',
        memberId: 'user_jane',
        destination: 'jane@example.com',
      });
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.data.memberId).toBe('user_jane');
    });

    it('rejects missing or short destination', () => {
      const result = validateRegistrationInput({
        workshopId: 'ws-123',
        memberId: 'user_jane',
        destination: 'a',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toMatch(/at least 3 characters/i);
    });

    it('rejects missing workshopId or memberId', () => {
      const result = validateRegistrationInput({
        workshopId: '',
        memberId: '',
        destination: 'jane@example.com',
      });
      expect(result.isValid).toBe(false);
      expect(result.errors.length).toBe(2);
    });
  });

  describe('validateCancellationConfirmation', () => {
    it('returns true for affirmative inputs', () => {
      expect(validateCancellationConfirmation('yes')).toBe(true);
      expect(validateCancellationConfirmation('y')).toBe(true);
      expect(validateCancellationConfirmation('YES')).toBe(true);
      expect(validateCancellationConfirmation('  Y  ')).toBe(true);
    });

    it('returns false for negative or invalid inputs', () => {
      expect(validateCancellationConfirmation('no')).toBe(false);
      expect(validateCancellationConfirmation('n')).toBe(false);
      expect(validateCancellationConfirmation('')).toBe(false);
      expect(validateCancellationConfirmation(null)).toBe(false);
    });
  });

  describe('validateFailureSimulationChoice', () => {
    it('accepts numbers 1 through 6', () => {
      expect(validateFailureSimulationChoice('1')).toBe(true);
      expect(validateFailureSimulationChoice('3')).toBe(true);
      expect(validateFailureSimulationChoice('6')).toBe(true);
    });

    it('rejects out of range choices', () => {
      expect(validateFailureSimulationChoice('0')).toBe(false);
      expect(validateFailureSimulationChoice('7')).toBe(false);
      expect(validateFailureSimulationChoice('foo')).toBe(false);
    });
  });
});
