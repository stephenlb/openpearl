# Tenant extensions

`tenants/<tenant>/extensions/<slug>/` holds the extensions built for each tenant from customer requests. The pipeline (`.github/workflows/tenant-feature.yml`) writes here, and only inside the requesting tenant's directory. See [framework/EXTENSIONS.md](../framework/EXTENSIONS.md).
