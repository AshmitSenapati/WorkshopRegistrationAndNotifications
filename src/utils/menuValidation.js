/**
 * Input validation helpers for the CLI interactive menu.
 * Validates user input before dispatching HTTP requests to backend services.
 */

export function validateWorkshopInput({ title, description, organizerId }) {
  const errors = [];
  if (!title || typeof title !== 'string' || title.trim().length === 0) {
    errors.push('Title is required and cannot be empty.');
  } else if (title.trim().length > 200) {
    errors.push('Title cannot exceed 200 characters.');
  }

  if (!description || typeof description !== 'string' || description.trim().length === 0) {
    errors.push('Description is required and cannot be empty.');
  }

  if (!organizerId || typeof organizerId !== 'string' || organizerId.trim().length === 0) {
    errors.push('Organizer ID is required and cannot be empty.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: errors.length === 0 ? {
      title: title.trim(),
      description: description.trim(),
      organizerId: organizerId.trim(),
    } : null,
  };
}

export function validateRegistrationInput({ workshopId, memberId, destination }) {
  const errors = [];
  if (!workshopId || typeof workshopId !== 'string' || workshopId.trim().length === 0) {
    errors.push('Workshop ID is required.');
  }

  if (!memberId || typeof memberId !== 'string' || memberId.trim().length === 0) {
    errors.push('Member ID is required.');
  }

  if (!destination || typeof destination !== 'string' || destination.trim().length === 0) {
    errors.push('Notification destination (email or contact) is required.');
  } else if (destination.trim().length < 3) {
    errors.push('Notification destination must be at least 3 characters.');
  }

  return {
    isValid: errors.length === 0,
    errors,
    data: errors.length === 0 ? {
      workshopId: workshopId.trim(),
      memberId: memberId.trim(),
      destination: destination.trim(),
    } : null,
  };
}

export function validateCancellationConfirmation(input) {
  if (!input || typeof input !== 'string') return false;
  const normalized = input.trim().toLowerCase();
  return normalized === 'yes' || normalized === 'y';
}

export function validateFailureSimulationChoice(choice) {
  const validChoices = ['1', '2', '3', '4', '5', '6'];
  return validChoices.includes(String(choice).trim());
}
