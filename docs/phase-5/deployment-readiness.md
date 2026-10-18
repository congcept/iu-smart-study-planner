# Deployment readiness

This is a configuration preflight increment. No application has been deployed and no
production service, database, secret or curriculum assignment has been changed.

With `NODE_ENV=production`, `CORS_ORIGIN` must explicitly name one HTTP or HTTPS browser
origin, such as `https://planner.example.test`. Missing/blank values, wildcards, lists,
credentials, non-root paths, query strings, fragments, backslashes and whitespace fail
configuration loading before the database connection or HTTP listener starts. Errors name
the configuration requirement without echoing its supplied value.

The server stores the canonical URL origin: host/protocol casing, a root slash and default
ports normalize to the browser's Origin representation. This value feeds both CORS headers
and the existing cookie-write origin check. There is no new allowed-host or hosting-provider
policy. HTTP remains accepted by this parser; production HTTPS, proxy, domain and same-site
cookie topology still need an explicit deployment decision and verification.

Development/test keep their existing explicit origin or localhost fallback. Production JWT
secret validation, secure cookies and disabled demo login remain in effect. The tests cover
pure origin parsing and the real invalid-configuration entry point, plus accepted
configuration/cookie flags. Only dotenv file loading is isolated; Prisma is not mocked.
Passing startup cases do not connect to a database or open a socket. Development behavior
and the existing JWT guard are covered.

Remaining deployment work includes choosing the hosting and cookie topology, supplying real
secrets securely, reviewing migrations and operational recovery, and exercising the deployed
student/admin flows. This preflight does not satisfy these deployment gates.
