/**
 * Re-exports all MSW handlers from the handlers directory.
 * This file maintains backward compatibility with existing test setup.
 */
import { allHandlers } from '@/test/handlers';

export const handlers = allHandlers;
