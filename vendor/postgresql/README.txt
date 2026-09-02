COPEC Windows — PostgreSQL embarqué

Le build Windows doit contenir un PostgreSQL portable complet :
  vendor/postgresql/bin/*.exe
  vendor/postgresql/lib/*
  vendor/postgresql/share/postgresql.conf.sample
  vendor/postgresql/share/...

Sur le PC développeur, exécutez scripts/prepare-postgresql-vendor.ps1 avant le build.
L'utilisateur final n'installe ni PostgreSQL ni pgAdmin.
