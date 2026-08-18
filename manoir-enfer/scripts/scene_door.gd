extends Area2D

@export_file("*.tscn") var target_scene: String = ""

func _ready() -> void:
	body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node2D) -> void:
	if target_scene != "" and body.is_in_group("player"):
		get_tree().change_scene_to_file(target_scene)
