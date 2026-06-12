use tauri_plugin_sql::{Migration, MigrationKind};

pub fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create_attune_session_tables",
            sql: include_str!("migrations/attune-sessions.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "attention_feedback_and_emotion_columns",
            sql: include_str!("migrations/attune-v2-feedback.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "ml_inference_and_distraction_events",
            sql: include_str!("migrations/attune-v3-ml.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "screening_sessions_and_samples",
            sql: include_str!("migrations/attune-v4-screening.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "screening_trials_and_science",
            sql: include_str!("migrations/attune-v5-screening-science.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "training_sessions_and_compliance",
            sql: include_str!("migrations/attune-v6-training.sql"),
            kind: MigrationKind::Up,
        },
    ]
}
