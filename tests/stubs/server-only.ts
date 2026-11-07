/*
   The real `server-only` package throws the moment it is imported outside
   React's server runtime, which is its whole job. Under vitest there is no
   React runtime to be outside of, so it is aliased to this empty module.
*/
export {};
