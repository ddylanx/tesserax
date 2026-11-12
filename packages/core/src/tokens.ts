/** Nest injection tokens for shared infrastructure (provided by apps/api InfraModule). */
export const CONFIG = Symbol('CONFIG');
export const DB = Symbol('DB');
export const QUEUE = Symbol('QUEUE');
export const SCHEDULES = Symbol('SCHEDULES');
export const PROJECT_DIRECTORY = Symbol('PROJECT_DIRECTORY');
/** Team roles by key (RoleLookup in @tesserax/contracts), provided by @tesserax/mod-team. */
export const ROLE_LOOKUP = Symbol('ROLE_LOOKUP');
/** Which workflows name a Team role (WorkflowUsage in @tesserax/contracts), supplied to TeamModule.forRoot by the host. */
export const WORKFLOW_USAGE = Symbol('WORKFLOW_USAGE');
