fn main() {
    #[cfg(target_os = "macos")]
    {
        compile_swift();
        compile_coreml_models();
    }

    tauri_build::build()
}

#[cfg(target_os = "macos")]
fn compile_coreml_models() {
    use std::env;
    use std::fs;
    use std::path::PathBuf;
    use std::process::Command;

    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    let models_dir = PathBuf::from(&manifest_dir).join("models");

    println!("cargo:rerun-if-changed={}", models_dir.display());

    let Ok(entries) = fs::read_dir(&models_dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("mlmodel") {
            continue;
        }

        let compiled = path.with_extension("mlmodelc");
        let needs_compile = match (fs::metadata(&path), fs::metadata(&compiled)) {
            (Ok(src), Ok(dst)) => {
                src.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH)
                    > dst.modified().unwrap_or(std::time::SystemTime::UNIX_EPOCH)
            }
            (Ok(_), Err(_)) => true,
            _ => false,
        };

        if !needs_compile {
            continue;
        }

        let status = Command::new("xcrun")
            .args([
                "coremlcompiler",
                "compile",
                &path.to_string_lossy(),
                &models_dir.to_string_lossy(),
            ])
            .status()
            .expect("Failed to run coremlcompiler — ensure Xcode command line tools are installed");

        if !status.success() {
            panic!("coremlcompiler failed for {}", path.display());
        }
    }
}

#[cfg(target_os = "macos")]
fn compile_swift() {
    use std::env;
    use std::path::PathBuf;
    use std::process::Command;

    let out_dir = env::var("OUT_DIR").expect("OUT_DIR not set");
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    let swift_dir = PathBuf::from(&manifest_dir).join("swift");
    let lib_path = PathBuf::from(&out_dir).join("libattune_vision.a");

    println!("cargo:rerun-if-changed={}", swift_dir.display());

    let swift_files = [
        "AttuneVision.swift",
        "AttuneInference.swift",
        "AttuneFaceCrop.swift",
        "AttuneGazePreprocess.swift",
        "AttuneWorkspace.swift",
    ];
    let mut args = vec![
        "-emit-library".to_string(),
        "-static".to_string(),
        "-o".to_string(),
        lib_path.to_string_lossy().to_string(),
        "-module-name".to_string(),
        "AttuneVision".to_string(),
        "-framework".to_string(),
        "AVFoundation".to_string(),
        "-framework".to_string(),
        "Vision".to_string(),
        "-framework".to_string(),
        "AppKit".to_string(),
        "-framework".to_string(),
        "Foundation".to_string(),
        "-framework".to_string(),
        "CoreML".to_string(),
        "-sdk".to_string(),
        macos_sdk_path(),
    ];

    for file in &swift_files {
        let path = swift_dir.join(file);
        println!("cargo:rerun-if-changed={}", path.display());
        args.push(path.to_string_lossy().to_string());
    }

    let status = Command::new("swiftc")
        .args(&args)
        .status()
        .expect("Failed to run swiftc — ensure Xcode command line tools are installed");

    if !status.success() {
        panic!("swiftc failed to compile Attune vision library");
    }

    println!("cargo:rustc-link-search=native={}", out_dir);
    println!("cargo:rustc-link-lib=static=attune_vision");
    println!("cargo:rustc-link-lib=framework=AVFoundation");
    println!("cargo:rustc-link-lib=framework=Vision");
    println!("cargo:rustc-link-lib=framework=AppKit");
    println!("cargo:rustc-link-lib=framework=Foundation");
    println!("cargo:rustc-link-lib=framework=CoreML");
    println!("cargo:rustc-link-lib=framework=CoreMedia");
    println!("cargo:rustc-link-lib=framework=CoreVideo");
}

#[cfg(target_os = "macos")]
fn macos_sdk_path() -> String {
    use std::process::Command;

    let output = Command::new("xcrun")
        .args(["--show-sdk-path", "--sdk", "macosx"])
        .output()
        .expect("Failed to run xcrun");

    String::from_utf8(output.stdout)
        .expect("Invalid SDK path")
        .trim()
        .to_string()
}
