extends Area2D

@export var room_name: String = ""

func _ready() -> void:
	body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node2D) -> void:
	if room_name != "" and body.is_in_group("player"):
		MapTracker.mark_room_visited(room_name)
