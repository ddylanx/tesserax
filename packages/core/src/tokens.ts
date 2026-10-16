/** Nest injection tokens for shared infrastructure (provided by apps/api InfraModule). */
export const CONFIG = Symbol('CONFIG');
export const DB = Symbol('DB');
export const QUEUE = Symbol('QUEUE');
export const SCHEDULES = Symbol('SCHEDULES');
export const PROJECT_DIRECTORY = Symbol('PROJECT_DIRECTORY');
