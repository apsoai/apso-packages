module github.com/apsoai/apso-packages/go/domainevents

go 1.21

// AWS SDK service modules are intentionally NOT pinned here — their exact
// versions are resolved by the `go get @latest` step in CI (.github/workflows/go.yml).
require (
	github.com/glebarez/sqlite v1.11.0
	github.com/google/uuid v1.6.0
	github.com/segmentio/kafka-go v0.4.47
	gorm.io/datatypes v1.2.1
	gorm.io/gorm v1.25.11
)
