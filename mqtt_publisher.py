import random
import time
from datetime import datetime
from paho.mqtt import client as mqtt_client


broker = 'localhost'
port = 1883
topic = "/boat/velocity"
client_id = f'publish-{random.randint(0, 1000)}'

def connect_mqtt():
    def on_connect(client, userdata, flags, rc):
        if rc == 0:
            print("Connected to MQTT Broker!")
        else:
            print("Failed to connect, return code %d\n", rc)

    client = mqtt_client.Client(client_id)
    client.on_connect = on_connect
    client.connect(broker, port)
    return client


def publish(client):
    msg_count = 1
    while True:
        time.sleep(0.5)
        current_timestamp = datetime.now().isoformat()
        velocity_value = random.uniform(0, 30)
        msg = '{"timestamp": "%s", "velocity": %.2f}' % (current_timestamp, velocity_value)
        
        result = client.publish(topic, msg)
        status = result[0]
        
        if status == 0:
            print(f"Send `{msg}` to topic `{topic}`")
        else:
            print(f"Failed to send message to topic {topic}")
        
        msg_count += 1
        if msg_count > 500:
            break


def run():
    client = connect_mqtt()
    client.loop_start()
    publish(client)
    client.loop_stop()


if __name__ == '__main__':
    run()
