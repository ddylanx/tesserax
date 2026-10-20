---
name: php-conventions
description: Laravel and PHP conventions (Pint, composer scripts, PHPUnit/Pest, Artisan).
---
# Laravel & PHP Project Conventions
- Run Pint for code styling: `vendor/bin/pint --test`
- Run test suites: `composer test` or `php artisan test`
- No debug calls remaining: `dd()`, `dump()`, `ray()`
- Database changes must be in new migrations under `database/migrations/`
